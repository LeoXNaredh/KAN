import type { CapabilityDescriptor, CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { WolTransportPort } from "./WolTransportPort";
import type { SnmpTransportPort } from "./SnmpTransportPort";
import { NodeWolTransport } from "./infra/NodeWolTransport";
import { NodeSnmpTransport } from "./infra/NodeSnmpTransport";
import { isValidMacAddress } from "./magicPacket";

const DEFAULT_WOL_BROADCAST = "255.255.255.255";
const DEFAULT_WOL_PORT = 9;
const DEFAULT_SNMP_PORT = 161;
const DEFAULT_SNMP_COMMUNITY = "public";
const DISCOVER_TIMEOUT_MS = 3000;
/** sysDescr.0 — universal en cualquier agente SNMP compliant, usado solo para confirmar que responde de verdad. */
const SYS_DESCR_OID = "1.3.6.1.2.1.1.1.0";

interface WolTargetConfig {
  name: string;
  macAddress: string;
  broadcastAddress: string;
  port: number;
}

interface SnmpTargetConfig {
  name: string;
  host: string;
  port: number;
  community: string;
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

function sanitizeId(prefix: string, raw: string): string {
  return `${prefix}_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * `KAN_WOL_TARGETS`: `nombre|macAddress|broadcastIp:puerto` separados por
 * coma — broadcastIp:puerto opcional (default 255.255.255.255:9). Mismo
 * criterio "nunca escanea" que el resto de KAN_*_TARGETS: el target lo fija
 * esta variable, no la conversación — acá la razón no es tanto SSRF
 * (un magic packet a una MAC que no existe simplemente no hace nada) sino
 * evitar despertar sin querer una máquina real que la IA no debería poder
 * elegir libremente.
 */
function parseWolTargets(raw: string | undefined): WolTargetConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): WolTargetConfig | undefined => {
      const [name, macAddress, broadcastStr] = entry.split("|").map((part) => part?.trim());
      if (!name || !macAddress || !isValidMacAddress(macAddress)) return undefined;
      const [broadcastAddress, portStr] = (broadcastStr ?? "").split(":");
      const port = portStr ? Number(portStr) : DEFAULT_WOL_PORT;
      if (!Number.isFinite(port)) return undefined;
      return { name, macAddress, broadcastAddress: broadcastAddress || DEFAULT_WOL_BROADCAST, port };
    })
    .filter((config): config is WolTargetConfig => config !== undefined);
}

/** `KAN_SNMP_TARGETS`: `nombre|host:puerto|community` separados por coma — puerto y community opcionales (default 161/public). */
function parseSnmpTargets(raw: string | undefined): SnmpTargetConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): SnmpTargetConfig | undefined => {
      const [name, hostStr, community] = entry.split("|").map((part) => part?.trim());
      if (!name || !hostStr) return undefined;
      const [host, portStr] = hostStr.split(":");
      const port = portStr ? Number(portStr) : DEFAULT_SNMP_PORT;
      if (!host || !Number.isFinite(port)) return undefined;
      return { name, host, port, community: community || DEFAULT_SNMP_COMMUNITY };
    })
    .filter((config): config is SnmpTargetConfig => config !== undefined);
}

function validateOid(input: unknown): ValidationResult<string> {
  const oid = (input as { oid?: unknown } | null)?.oid;
  if (typeof oid !== "string" || !/^[\d.]+$/.test(oid)) return fail("'oid' debe ser un string numérico con puntos (ej. '1.3.6.1.2.1.1.1.0')");
  return ok(oid);
}

/**
 * Plugin de herramientas de red — Wake-on-LAN y SNMP en un solo plugin
 * (mismo criterio que plugin-gcode combinando Marlin/GRBL): ambos son
 * utilidades de red livianas sin binding nativo. Un "dispositivo" es un
 * target WoL o un agente SNMP ya configurado — nunca uno elegido por la
 * IA. `deviceId` distingue el tipo por prefijo (`wol_`/`snmp_`), así que
 * getCapabilities()/invoke() despachan según ese prefijo en vez de tener
 * dos plugins separados para algo tan chico.
 */
export class NetworkToolsDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "network-tools";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-network-tools",
    version: "0.1.0",
    displayName: "Herramientas de red (Wake-on-LAN, SNMP)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["network-tools"], network: true, filesystem: [] }),
  };

  private readonly wolTargets = new Map<string, WolTargetConfig>();
  private readonly snmpTargets = new Map<string, SnmpTargetConfig>();

  constructor(
    private readonly wolTransport: WolTransportPort = new NodeWolTransport(),
    private readonly snmpTransport: SnmpTransportPort = new NodeSnmpTransport(),
  ) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const wolConfigs = parseWolTargets(process.env.KAN_WOL_TARGETS);
    const wolDevices: DeviceDescriptor[] = wolConfigs.map((config) => {
      const id = sanitizeId("wol", config.name);
      this.wolTargets.set(id, config);
      return { id, name: `Wake-on-LAN (${config.name}, ${config.macAddress})`, kind: this.kind };
    });

    const snmpConfigs = parseSnmpTargets(process.env.KAN_SNMP_TARGETS);
    const snmpResults = await Promise.all(
      snmpConfigs.map(async (config) => {
        try {
          await this.snmpTransport.get(config.host, config.port, config.community, SYS_DESCR_OID, DISCOVER_TIMEOUT_MS);
          const id = sanitizeId("snmp", config.name);
          this.snmpTargets.set(id, config);
          return { id, name: `SNMP (${config.name}, ${config.host}:${config.port})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );

    return [...wolDevices, ...snmpResults.filter((device): device is DeviceDescriptor => device !== undefined)];
  }

  async connect(deviceId: string): Promise<void> {
    if (!this.wolTargets.has(deviceId) && !this.snmpTargets.has(deviceId)) {
      throw new Error(`Dispositivo desconocido: ${deviceId}`);
    }
  }

  async disconnect(_deviceId: string): Promise<void> {
    // Ninguno de los dos protocolos mantiene una conexión persistente — WoL es fire-and-forget UDP, SNMP abre/cierra una sesión por operación.
  }

  getCapabilities(deviceId: string): CapabilityDescriptor[] {
    if (deviceId.startsWith("wol_")) {
      return [
        defineCapability({
          name: "wake_on_lan",
          description: "Manda el magic packet Wake-on-LAN configurado para este dispositivo.",
          severity: "irreversible-material",
          supportsDryRun: false,
        }),
      ];
    }

    if (deviceId.startsWith("snmp_")) {
      return [
        defineCapability({
          name: "snmp_get",
          description: "Lee el valor exacto de un OID SNMP.",
          severity: "read-only",
          supportsDryRun: false,
          inputSchema: { type: "object", properties: { oid: { type: "string" } }, required: ["oid"] },
          targetParam: "oid",
        }),
        defineCapability({
          name: "snmp_walk",
          description: "Recorre el subárbol MIB a partir de un OID y devuelve todos los valores encontrados.",
          severity: "read-only",
          supportsDryRun: false,
          inputSchema: { type: "object", properties: { oid: { type: "string" } }, required: ["oid"] },
          targetParam: "oid",
        }),
      ];
    }

    return [];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const wolConfig = this.wolTargets.get(deviceId);
    if (wolConfig) return this.invokeWol(wolConfig, capabilityName);

    const snmpConfig = this.snmpTargets.get(deviceId);
    if (snmpConfig) return this.invokeSnmp(snmpConfig, capabilityName, input);

    return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
  }

  private async invokeWol(config: WolTargetConfig, capabilityName: string): Promise<CapabilityResult> {
    if (capabilityName !== "wake_on_lan") return { success: false, error: `Capability desconocida: ${capabilityName}` };
    try {
      await this.wolTransport.sendMagicPacket(config.macAddress, config.broadcastAddress, config.port);
      return { success: true, data: {} };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  }

  private async invokeSnmp(config: SnmpTargetConfig, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const oid = validateOid(input);
    if (!oid.ok) return { success: false, error: oid.error };

    if (capabilityName === "snmp_get") {
      try {
        const value = await this.snmpTransport.get(config.host, config.port, config.community, oid.value);
        return { success: true, data: { oid: oid.value, value } };
      } catch (error) {
        return { success: false, error: toMessage(error) };
      }
    }

    if (capabilityName === "snmp_walk") {
      try {
        const varbinds = await this.snmpTransport.walk(config.host, config.port, config.community, oid.value);
        return { success: true, data: { varbinds } };
      } catch (error) {
        return { success: false, error: toMessage(error) };
      }
    }

    return { success: false, error: `Capability desconocida: ${capabilityName}` };
  }
}

export type { WolTransportPort } from "./WolTransportPort";
export type { SnmpTransportPort, SnmpVarbind } from "./SnmpTransportPort";
export { NodeWolTransport } from "./infra/NodeWolTransport";
export { FakeWolTransport } from "./infra/FakeWolTransport";
export { NodeSnmpTransport } from "./infra/NodeSnmpTransport";
export { FakeSnmpTransport, type FakeSnmpDeviceConfig } from "./infra/FakeSnmpTransport";
export { buildMagicPacket, isValidMacAddress } from "./magicPacket";
