import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { OpcuaConnection, OpcuaCredentials, OpcuaTarget, OpcuaTransportPort, OpcuaValueType } from "./OpcuaTransportPort";
import { NodeOpcuaTransport } from "./infra/NodeOpcuaTransport";

const DISCOVER_TIMEOUT_MS = 5000;
const VALUE_TYPES: OpcuaValueType[] = ["Double", "Float", "Int32", "UInt32", "Boolean", "String"];

interface EndpointConfig {
  name: string;
  endpointUrl: string;
  credentials?: OpcuaCredentials;
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
  return `opcua_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * `KAN_OPCUA_TARGETS`: `nombre|endpointUrl|usuario|contraseña` separados
 * por coma — `usuario|contraseña` opcional (anónimo si se omite). Mismo
 * criterio "nunca escanea" que el resto de KAN_*_TARGETS/ENDPOINTS.
 */
function parseTargets(raw: string | undefined): EndpointConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): EndpointConfig | undefined => {
      const [name, endpointUrl, username, password] = entry.split("|").map((part) => part?.trim());
      if (!name || !endpointUrl) return undefined;
      const credentials = username && password ? { username, password } : undefined;
      return { name, endpointUrl, credentials };
    })
    .filter((config): config is EndpointConfig => config !== undefined);
}

function validateNodeId(input: unknown): ValidationResult<string> {
  const nodeId = (input as { nodeId?: unknown } | null)?.nodeId;
  if (typeof nodeId !== "string" || !nodeId.trim()) return fail("'nodeId' debe ser un string no vacío (ej. 'ns=1;s=MyVariable')");
  return ok(nodeId);
}

function validateDataType(input: unknown): ValidationResult<OpcuaValueType> {
  const dataType = (input as { dataType?: unknown } | null)?.dataType;
  if (typeof dataType !== "string" || !VALUE_TYPES.includes(dataType as OpcuaValueType)) {
    return fail(`'dataType' debe ser uno de: ${VALUE_TYPES.join(", ")}`);
  }
  return ok(dataType as OpcuaValueType);
}

/**
 * Plugin de OPC-UA — cliente de un endpoint industrial ya configurado,
 * nunca uno elegido por la IA (misma defensa contra SSRF que el resto de
 * los plugins de red). "Dispositivo" = un endpoint OPC-UA configurado;
 * cada `nodeId` (ej. "ns=1;s=Temperatura") es un target direccionable en
 * Safety Policy — mismo mecanismo que registros Modbus/entidades HA.
 *
 * `write_node` es `irreversible-material`, no `safety-critical` — mismo
 * nivel que `write_register` de Modbus, no el techo de `plugin-ssh`: OPC-UA
 * escribe un tag/variable puntual y acotado (análogo a un registro
 * Modbus), no ejecuta código arbitrario en el servidor.
 */
export class OpcuaDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "opcua";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-opcua",
    version: "0.1.0",
    displayName: "OPC-UA (industrial)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["opcua"], network: true, filesystem: [] }),
  };

  private readonly endpoints = new Map<string, EndpointConfig>();
  private readonly connections = new Map<string, OpcuaConnection>();

  constructor(private readonly transport: OpcuaTransportPort = new NodeOpcuaTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseTargets(process.env.KAN_OPCUA_TARGETS);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          const target: OpcuaTarget = { endpointUrl: config.endpointUrl, credentials: config.credentials };
          const connection = await this.transport.connect(target, { connectTimeoutMs: DISCOVER_TIMEOUT_MS });
          await connection.close();
          const id = sanitizeDeviceId(config.name);
          this.endpoints.set(id, config);
          return { id, name: `OPC-UA (${config.name}, ${config.endpointUrl})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const config = this.endpoints.get(deviceId);
    if (!config) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const target: OpcuaTarget = { endpointUrl: config.endpointUrl, credentials: config.credentials };
    const connection = await this.transport.connect(target);
    this.connections.set(deviceId, connection);
  }

  async disconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    await connection.close();
    this.connections.delete(deviceId);
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "read_node",
        description: "Lee el valor actual de un nodo OPC-UA (ej. 'ns=1;s=Temperatura').",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { nodeId: { type: "string" } }, required: ["nodeId"] },
        targetParam: "nodeId",
      }),
      defineCapability({
        name: "write_node",
        description: "Escribe el valor de un nodo OPC-UA — puede accionar hardware industrial real.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { nodeId: { type: "string" }, value: {}, dataType: { type: "string", enum: VALUE_TYPES } },
          required: ["nodeId", "value", "dataType"],
        },
        targetParam: "nodeId",
      }),
      defineCapability({
        name: "browse_node",
        description: "Lista los nodos hijos de un nodo OPC-UA (por defecto, la carpeta raíz).",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { nodeId: { type: "string" } } },
        targetParam: "nodeId",
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.endpoints.has(deviceId)) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    const connection = this.connections.get(deviceId);

    switch (capabilityName) {
      case "read_node": {
        const nodeId = validateNodeId(input);
        if (!nodeId.ok) return { success: false, error: nodeId.error };
        if (!connection) return { success: false, error: "Dispositivo no conectado" };
        try {
          const result = await connection.readNode(nodeId.value);
          return { success: true, data: result };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "write_node": {
        const nodeId = validateNodeId(input);
        if (!nodeId.ok) return { success: false, error: nodeId.error };
        const dataType = validateDataType(input);
        if (!dataType.ok) return { success: false, error: dataType.error };
        const value = (input as { value?: unknown } | null)?.value;
        if (value === undefined) return { success: false, error: "'value' es requerido" };
        if (!connection) return { success: false, error: "Dispositivo no conectado" };
        try {
          await connection.writeNode(nodeId.value, value, dataType.value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "browse_node": {
        const nodeId = (input as { nodeId?: unknown } | null)?.nodeId;
        const target = typeof nodeId === "string" && nodeId.trim() ? nodeId : "RootFolder";
        if (!connection) return { success: false, error: "Dispositivo no conectado" };
        try {
          const entries = await connection.browseNode(target);
          return { success: true, data: { entries } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }
}

export type {
  OpcuaBrowseEntry,
  OpcuaConnectOptions,
  OpcuaConnection,
  OpcuaCredentials,
  OpcuaNodeValue,
  OpcuaTarget,
  OpcuaTransportPort,
  OpcuaValueType,
} from "./OpcuaTransportPort";
export { NodeOpcuaTransport } from "./infra/NodeOpcuaTransport";
export { FakeOpcuaTransport, type FakeOpcuaEndpointConfig } from "./infra/FakeOpcuaTransport";
