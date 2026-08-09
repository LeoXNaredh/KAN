import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { HttpTransportPort } from "@kan/plugin-http-generic";
import { FetchHttpTransport } from "@kan/plugin-http-generic";
import { defaultSeverityForEntity } from "./entityDomain";

const DISCOVER_TIMEOUT_MS = 3000;

interface InstanceConfig {
  name: string;
  baseUrl: string;
  token: string;
}

interface HaEntityState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeDeviceId(raw: string): string {
  return `ha_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function authHeaderFor(token: string) {
  return { name: "Authorization", value: `Bearer ${token}` };
}

/**
 * `KAN_HOME_ASSISTANT_INSTANCES`: `nombre|baseUrl|token` separados por
 * coma — a diferencia de KAN_HTTP_ENDPOINTS/KAN_WS_ENDPOINTS, el auth de HA
 * siempre es un token de acceso de larga duración como
 * `Authorization: Bearer`, así que no hace falta el formato genérico
 * "Header:valor". Mismo criterio "nunca escanea" que el resto de
 * KAN_*_ENDPOINTS/BROKERS.
 */
function parseInstances(raw: string | undefined): InstanceConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, baseUrl, token] = entry.split("|").map((part) => part?.trim());
      return { name, baseUrl, token };
    })
    .filter((config): config is InstanceConfig => Boolean(config.name && config.baseUrl && config.token));
}

function validateEntityId(input: unknown): ValidationResult<string> {
  const entityId = (input as { entity_id?: unknown } | null)?.entity_id;
  if (typeof entityId !== "string" || !entityId.trim() || !entityId.includes(".")) {
    return fail("'entity_id' debe ser un string con formato 'dominio.nombre' (ej. 'light.living_room')");
  }
  return ok(entityId);
}

/**
 * Plugin de Home Assistant — cliente REST de una instancia HA ya
 * configurada, nunca elegida por la IA (misma defensa contra SSRF que
 * plugin-http-generic, del que reusa el transporte tal cual — mismo
 * criterio que plugin-gcode reusando @kan/serial-line-transport de
 * plugin-esp32-arduino, no duplicar un cliente HTTP que ya existe).
 *
 * A diferencia de docs/04 (que lo lista como ejemplo de "Skill/
 * Integración"), se implementa como device-driver: HA controla actuadores
 * físicos reales (cerraduras, portones, climatización) — exactamente el
 * dominio de Safety Policy/severidad, no algo que un plugin de integración
 * sin ese sistema cubriría bien.
 *
 * "Dispositivo" = una instancia HA configurada; cada entity_id es un
 * target direccionable en Safety Policy, con severidad por defecto según
 * su dominio (ver entityDomain.ts) — mismo mecanismo que topics MQTT/paths
 * HTTP genérico. A diferencia de MQTT (targets poblados incrementalmente
 * por suscripción), acá se poblan todos de una en connect(): GET
 * /api/states ya trae todas las entidades conocidas, no hay nada que
 * "suscribir" primero.
 */
export class HomeAssistantDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "home-assistant";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-home-assistant",
    version: "0.1.0",
    displayName: "Home Assistant",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["home-assistant"], network: true, filesystem: [] }),
  };

  private readonly instances = new Map<string, InstanceConfig>();
  private readonly entityCache = new Map<string, HaEntityState[]>();

  constructor(private readonly transport: HttpTransportPort = new FetchHttpTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseInstances(process.env.KAN_HOME_ASSISTANT_INSTANCES);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          // GET /api/ confirma alcanzabilidad Y que el token es válido — a
          // diferencia de plugin-http-generic (que no puede saber si un
          // endpoint arbitrario exige auth), acá sabemos que HA siempre la
          // exige, así que un status distinto de 200 sí debe descartar el
          // dispositivo, no solo un error de red.
          const response = await this.transport.request(config.baseUrl, {
            method: "GET",
            path: "/api/",
            authHeader: authHeaderFor(config.token),
            timeoutMs: DISCOVER_TIMEOUT_MS,
          });
          if (response.status !== 200) return undefined;
          const id = sanitizeDeviceId(config.name);
          this.instances.set(id, config);
          return { id, name: `Home Assistant (${config.name}, ${hostOf(config.baseUrl)})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const config = this.instances.get(deviceId);
    if (!config) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    await this.refreshEntities(deviceId, config);
  }

  async disconnect(_deviceId: string): Promise<void> {
    // HTTP es sin sesión — sin estado de conexión persistente que cerrar.
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "list_ha_entities",
        description: "Lista todas las entidades conocidas de esta instancia de Home Assistant con su estado actual.",
        severity: "read-only",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "get_ha_state",
        description: "Devuelve el estado y atributos actuales de una entidad de Home Assistant.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { entity_id: { type: "string" } },
          required: ["entity_id"],
        },
        targetParam: "entity_id",
      }),
      defineCapability({
        name: "call_ha_service",
        description: "Llama a un servicio de Home Assistant sobre una entidad (ej. light.turn_on) — puede accionar hardware real.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            service: { type: "string" },
            entity_id: { type: "string" },
            data: {},
          },
          required: ["domain", "service", "entity_id"],
        },
        targetParam: "entity_id",
      }),
    ];
  }

  listTargets(deviceId: string): TargetDescriptor[] {
    const entities = this.entityCache.get(deviceId);
    if (!entities) return [];
    return entities.map((entity) => ({
      target: entity.entity_id,
      suggestedAlias: typeof entity.attributes?.friendly_name === "string" ? (entity.attributes.friendly_name as string) : undefined,
      defaultSeverity: defaultSeverityForEntity(entity.entity_id),
    }));
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const config = this.instances.get(deviceId);
    if (!config) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };

    switch (capabilityName) {
      case "list_ha_entities": {
        try {
          await this.refreshEntities(deviceId, config);
          return { success: true, data: { entities: this.entityCache.get(deviceId) ?? [] } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "get_ha_state": {
        const entityId = validateEntityId(input);
        if (!entityId.ok) return { success: false, error: entityId.error };

        try {
          const response = await this.transport.request(config.baseUrl, {
            method: "GET",
            path: `/api/states/${entityId.value}`,
            authHeader: authHeaderFor(config.token),
          });
          if (response.status === 404) return { success: false, error: `Entidad desconocida: ${entityId.value}` };
          return { success: true, data: response.body };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "call_ha_service": {
        const entityId = validateEntityId(input);
        if (!entityId.ok) return { success: false, error: entityId.error };
        const domain = (input as { domain?: unknown } | null)?.domain;
        const service = (input as { service?: unknown } | null)?.service;
        if (typeof domain !== "string" || !domain.trim()) return { success: false, error: "'domain' debe ser un string no vacío" };
        if (typeof service !== "string" || !service.trim()) return { success: false, error: "'service' debe ser un string no vacío" };
        const data = (input as { data?: unknown } | null)?.data;
        const extraData = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

        try {
          const response = await this.transport.request(config.baseUrl, {
            method: "POST",
            path: `/api/services/${domain}/${service}`,
            authHeader: authHeaderFor(config.token),
            body: { entity_id: entityId.value, ...extraData },
          });
          return { success: true, data: response.body };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private async refreshEntities(deviceId: string, config: InstanceConfig): Promise<void> {
    const response = await this.transport.request(config.baseUrl, {
      method: "GET",
      path: "/api/states",
      authHeader: authHeaderFor(config.token),
    });
    this.entityCache.set(deviceId, Array.isArray(response.body) ? (response.body as HaEntityState[]) : []);
  }
}

export { defaultSeverityForEntity, domainOf } from "./entityDomain";
