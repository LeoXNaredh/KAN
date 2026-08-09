import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { HttpAuthHeader, HttpMethod, HttpTransportPort } from "./HttpTransportPort";
import { FetchHttpTransport } from "./infra/FetchHttpTransport";

const DISCOVER_TIMEOUT_MS = 3000;

interface EndpointConfig {
  name: string;
  baseUrl: string;
  authHeader: HttpAuthHeader | undefined;
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
  return `http_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function parseAuthHeader(raw: string): HttpAuthHeader | undefined {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) return undefined;
  return { name: raw.slice(0, separatorIndex).trim(), value: raw.slice(separatorIndex + 1).trim() };
}

/**
 * `KAN_HTTP_ENDPOINTS`: `nombre|baseUrl|Header:valor` separados por coma
 * (el header es opcional) — mismo criterio "nunca escanea" que
 * KAN_MQTT_BROKERS/KAN_ESP32_WIFI_HOSTS: el host lo fija config, no la
 * conversación — es la única defensa real contra SSRF (ver README).
 * Limitación conocida, igual que la contraseña con coma de
 * KAN_MQTT_BROKERS: un valor de header con coma o pipe rompe el parseo; no
 * vale la pena resolverlo hasta que sea un caso real.
 */
function parseEndpoints(raw: string | undefined): EndpointConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, baseUrl, authPart] = entry.split("|").map((part) => part?.trim());
      return { name, baseUrl, authHeader: authPart ? parseAuthHeader(authPart) : undefined };
    })
    .filter((config): config is EndpointConfig => Boolean(config.name && config.baseUrl));
}

function validatePath(input: unknown): ValidationResult<string> {
  const path = (input as { path?: unknown } | null)?.path;
  if (typeof path !== "string" || !path.trim()) return fail("'path' debe ser un string no vacío");
  return ok(path);
}

const HTTP_METHOD_BY_CAPABILITY: Record<string, HttpMethod> = {
  http_get: "GET",
  http_post: "POST",
  http_put: "PUT",
  http_patch: "PATCH",
  http_delete: "DELETE",
};

/**
 * Plugin genérico de HTTP/REST — cliente de endpoints ya configurados,
 * nunca uno elegido por la IA o el usuario en la conversación. Un
 * "dispositivo" es un endpoint base configurado; cada `path` que se invoca
 * es un target direccionable por Safety Policy — mismo mecanismo que
 * topics MQTT / pines ESP32, sin tocar esa infraestructura.
 *
 * `discover()` sí hace un chequeo de alcanzabilidad real (a diferencia de
 * plugin-gcode, que nunca prueba nada) — un GET a la base es inofensivo
 * (no como mandar G-code a un puerto desconocido), y confirma "hay un
 * servidor HTTP ahí" igual que MQTT confirma "hay un broker ahí": ni uno ni
 * otro puede confirmar más que eso.
 */
export class HttpDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "http-generic";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-http-generic",
    version: "0.1.0",
    displayName: "HTTP/REST (endpoint configurado)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["http-generic"], network: true, filesystem: [] }),
  };

  private readonly endpoints = new Map<string, EndpointConfig>();

  constructor(private readonly transport: HttpTransportPort = new FetchHttpTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseEndpoints(process.env.KAN_HTTP_ENDPOINTS);
    const results = await Promise.all(
      configs.map(async (config) => {
        const reachable = await this.transport.checkReachable(config.baseUrl, DISCOVER_TIMEOUT_MS);
        if (!reachable) return undefined;
        const id = sanitizeDeviceId(config.name);
        this.endpoints.set(id, config);
        return { id, name: `HTTP (${config.name}, ${hostOf(config.baseUrl)})`, kind: this.kind };
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    if (!this.endpoints.has(deviceId)) throw new Error(`Dispositivo desconocido: ${deviceId}`);
  }

  async disconnect(_deviceId: string): Promise<void> {
    // HTTP es sin sesión — sin estado de conexión persistente que cerrar.
  }

  getCapabilities(_deviceId: string) {
    const bodySchema = {
      type: "object" as const,
      properties: { path: { type: "string" as const }, body: {} },
      required: ["path"],
    };
    const withBody = (name: string, description: string) =>
      defineCapability({
        name,
        description,
        severity: "irreversible-material" as const,
        supportsDryRun: false,
        inputSchema: bodySchema,
        targetParam: "path",
      });

    return [
      defineCapability({
        name: "http_get",
        description: "Hace un GET al path indicado dentro del endpoint configurado.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, query: { type: "object" } },
          required: ["path"],
        },
        targetParam: "path",
      }),
      withBody("http_post", "Hace un POST al path indicado — puede tener efectos reales del otro lado."),
      withBody("http_put", "Hace un PUT al path indicado — puede tener efectos reales del otro lado."),
      withBody("http_patch", "Hace un PATCH al path indicado — puede tener efectos reales del otro lado."),
      defineCapability({
        name: "http_delete",
        description: "Hace un DELETE al path indicado — puede tener efectos reales del otro lado.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        targetParam: "path",
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const config = this.endpoints.get(deviceId);
    if (!config) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };

    const method = HTTP_METHOD_BY_CAPABILITY[capabilityName];
    if (!method) return { success: false, error: `Capability desconocida: ${capabilityName}` };

    const path = validatePath(input);
    if (!path.ok) return { success: false, error: path.error };

    const query = (input as { query?: unknown } | null)?.query;
    const body = (input as { body?: unknown } | null)?.body;

    try {
      const response = await this.transport.request(config.baseUrl, {
        method,
        path: path.value,
        query: typeof query === "object" && query !== null ? (query as Record<string, string>) : undefined,
        body,
        authHeader: config.authHeader,
      });
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  }
}

export type { HttpAuthHeader, HttpMethod, HttpRequestOptions, HttpResponse, HttpTransportPort } from "./HttpTransportPort";
export { FetchHttpTransport } from "./infra/FetchHttpTransport";
export { FakeHttpTransport, type FakeHttpEndpointConfig } from "./infra/FakeHttpTransport";
