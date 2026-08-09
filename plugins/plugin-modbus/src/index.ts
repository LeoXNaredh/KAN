import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { ModbusConnection, ModbusTarget, ModbusTransportPort } from "./ModbusTransportPort";
import { NodeModbusTransport } from "./infra/NodeModbusTransport";

const DISCOVER_TIMEOUT_MS = 3000;
const DEFAULT_UNIT_ID = 1;
const DEFAULT_BAUD_RATE = 9600;
const REGISTER_PATTERN = /^(holding|input|coil|discrete):(\d+)$/;

type TargetConfig = { name: string } & ModbusTarget;

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
  return `modbus_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function describeTarget(config: TargetConfig): string {
  if (config.kind === "tcp") return `TCP ${config.host}:${config.port}`;
  return `RTU ${config.path}@${config.baudRate}`;
}

/**
 * `KAN_MODBUS_TARGETS`: `nombre|tipo|conexión` separados por coma — `tipo`
 * es `tcp` o `rtu-serial`. `conexión` es `host:puerto` para tcp, o
 * `puertoSerial:baudRate` para rtu-serial (baudRate opcional, default
 * 9600). Mismo criterio "nunca escanea" que el resto de
 * KAN_*_ENDPOINTS/BROKERS/INSTANCES — el target lo fija esta variable, no
 * la conversación.
 *
 * Nota de diseño: no existe un tercer modo "RTU sobre TCP" separado.
 * `modbus-serial` tiene un método `connectTcpRTUBuffered` que por el
 * nombre sugiere RTU crudo sobre un socket TCP, pero leyendo su código
 * fuente (`tcprtubufferedport.js`) arma el mismo framing MBAP que
 * `connectTCP` para lo que sale por la red — solo reconstruye un CRC
 * sintético del lado del cliente para reusar el parser de RTU
 * internamente. Verificado en vivo (ver ADR-047): un servidor Modbus TCP
 * real no distingue una conexión de la otra. Un gateway que haga un túnel
 * de bytes RTU crudos de verdad (no traducción de protocolo) no está
 * cubierto por este plugin todavía.
 *
 * Ej.: `KAN_MODBUS_TARGETS=plc1|tcp|192.168.1.50:502,sensor1|rtu-serial|COM3:9600`
 */
function parseTargets(raw: string | undefined): TargetConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): TargetConfig | undefined => {
      const [name, kind, connStr] = entry.split("|").map((part) => part?.trim());
      if (!name || !connStr) return undefined;

      if (kind === "tcp") {
        const [host, portStr] = connStr.split(":");
        const port = Number(portStr);
        if (!host || !Number.isFinite(port)) return undefined;
        return { name, kind, host, port };
      }
      if (kind === "rtu-serial") {
        const [path, baudStr] = connStr.split(":");
        const baudRate = baudStr ? Number(baudStr) : DEFAULT_BAUD_RATE;
        if (!path || !Number.isFinite(baudRate)) return undefined;
        return { name, kind, path, baudRate };
      }
      return undefined;
    })
    .filter((config): config is TargetConfig => config !== undefined);
}

function validateRegister(input: unknown, allowedKinds: string[]): ValidationResult<{ kind: string; address: number }> {
  const register = (input as { register?: unknown } | null)?.register;
  if (typeof register !== "string") {
    return fail("'register' debe ser un string con formato 'tipo:dirección' (ej. 'holding:100')");
  }
  const match = REGISTER_PATTERN.exec(register);
  if (!match) return fail("'register' debe tener el formato 'tipo:dirección', tipo uno de: holding, input, coil, discrete");
  const [, kind, addressStr] = match;
  if (!allowedKinds.includes(kind)) {
    return fail(`'register' de tipo '${kind}' no es válido acá — usá: ${allowedKinds.join(", ")}`);
  }
  return ok({ kind, address: Number(addressStr) });
}

function parseUnitId(input: unknown): number {
  const unitId = (input as { unitId?: unknown } | null)?.unitId;
  return typeof unitId === "number" && Number.isInteger(unitId) ? unitId : DEFAULT_UNIT_ID;
}

function parseLength(input: unknown): number {
  const length = (input as { length?: unknown } | null)?.length;
  return typeof length === "number" && Number.isInteger(length) && length > 0 ? length : 1;
}

/**
 * Plugin genérico de Modbus (TCP + RTU, mismo criterio que plugin-gcode
 * cubriendo Marlin/GRBL con un solo plugin) — cliente de un target ya
 * configurado, nunca uno elegido por la IA (misma defensa contra SSRF que
 * el resto de los plugins de red). "Dispositivo" = un target Modbus
 * configurado (TCP o RTU serial real — ver el comentario de
 * parseTargets sobre por qué no hay un tercer modo "RTU sobre TCP").
 *
 * El target de Safety Policy es un string compuesto `"tipo:dirección"`
 * (ej. "holding:100"), no la dirección numérica sola: holding/input/coil/
 * discrete son espacios de direcciones independientes que pueden compartir
 * el mismo número, y SafetyPolicyStore clasifica por (deviceId, target)
 * sin conocer la capability — un target plano colisionaría entre espacios
 * (ej. clasificar "100" pensando en un holding register también afectaría
 * a un input register 100 no relacionado).
 *
 * Sin listTargets() propio (queda vacío, como plugin-esp32-arduino/
 * plugin-gcode): a diferencia de MQTT (que puebla targets por topics
 * suscritos) o Home Assistant (que trae todas las entidades de una con
 * GET /api/states), Modbus no tiene forma de enumerar qué registros existen
 * — el usuario los conoce por la documentación de su propio dispositivo y
 * los clasifica en Safety Policy a medida que los usa.
 *
 * discover() solo abre lo que el usuario configuró explícitamente y
 * confirma que la conexión abre — no que el target hable Modbus de
 * verdad (Modbus no tiene un comando de identificación universal, mismo
 * caso que plugin-gcode con G-code).
 */
export class ModbusDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "modbus";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-modbus",
    version: "0.1.0",
    displayName: "Modbus (TCP / RTU)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["modbus"], network: true, filesystem: [] }),
  };

  private readonly targets = new Map<string, TargetConfig>();
  private readonly connections = new Map<string, ModbusConnection>();

  constructor(private readonly transport: ModbusTransportPort = new NodeModbusTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseTargets(process.env.KAN_MODBUS_TARGETS);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          const connection = await this.transport.connect(config, { connectTimeoutMs: DISCOVER_TIMEOUT_MS });
          await connection.close();
          const id = sanitizeDeviceId(config.name);
          this.targets.set(id, config);
          return { id, name: `Modbus (${config.name}, ${describeTarget(config)})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const config = this.targets.get(deviceId);
    if (!config) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection = await this.transport.connect(config);
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
        name: "read_registers",
        description: "Lee uno o más holding/input registers (formato de 'register': 'holding:100' o 'input:100').",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { register: { type: "string" }, length: { type: "number" }, unitId: { type: "number" } },
          required: ["register"],
        },
        targetParam: "register",
      }),
      defineCapability({
        name: "read_coils",
        description: "Lee uno o más coils/discrete inputs (formato de 'register': 'coil:5' o 'discrete:5').",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { register: { type: "string" }, length: { type: "number" }, unitId: { type: "number" } },
          required: ["register"],
        },
        targetParam: "register",
      }),
      defineCapability({
        name: "write_register",
        description: "Escribe un holding register (formato de 'register': 'holding:100') — puede accionar hardware real.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { register: { type: "string" }, value: { type: "number" }, unitId: { type: "number" } },
          required: ["register", "value"],
        },
        targetParam: "register",
      }),
      defineCapability({
        name: "write_coil",
        description: "Escribe un coil (formato de 'register': 'coil:5') — puede accionar hardware real (relé, actuador).",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { register: { type: "string" }, value: { type: "boolean" }, unitId: { type: "number" } },
          required: ["register", "value"],
        },
        targetParam: "register",
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.targets.has(deviceId)) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    const connection = this.connections.get(deviceId);

    switch (capabilityName) {
      case "read_registers": {
        const register = validateRegister(input, ["holding", "input"]);
        if (!register.ok) return { success: false, error: register.error };
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          const unitId = parseUnitId(input);
          const length = parseLength(input);
          const values =
            register.value.kind === "holding"
              ? await connection.readHoldingRegisters(unitId, register.value.address, length)
              : await connection.readInputRegisters(unitId, register.value.address, length);
          return { success: true, data: { values } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "read_coils": {
        const register = validateRegister(input, ["coil", "discrete"]);
        if (!register.ok) return { success: false, error: register.error };
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          const unitId = parseUnitId(input);
          const length = parseLength(input);
          const values =
            register.value.kind === "coil"
              ? await connection.readCoils(unitId, register.value.address, length)
              : await connection.readDiscreteInputs(unitId, register.value.address, length);
          return { success: true, data: { values } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "write_register": {
        const register = validateRegister(input, ["holding"]);
        if (!register.ok) return { success: false, error: register.error };
        const value = (input as { value?: unknown } | null)?.value;
        if (typeof value !== "number" || !Number.isInteger(value)) return { success: false, error: "'value' debe ser un número entero" };
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          await connection.writeRegister(parseUnitId(input), register.value.address, value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "write_coil": {
        const register = validateRegister(input, ["coil"]);
        if (!register.ok) return { success: false, error: register.error };
        const value = (input as { value?: unknown } | null)?.value;
        if (typeof value !== "boolean") return { success: false, error: "'value' debe ser boolean" };
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          await connection.writeCoil(parseUnitId(input), register.value.address, value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }
}

export type { ModbusConnectOptions, ModbusConnection, ModbusTarget, ModbusTransportPort } from "./ModbusTransportPort";
export { NodeModbusTransport } from "./infra/NodeModbusTransport";
export { FakeModbusTransport, type FakeModbusTargetConfig, type FakeModbusUnitRegisters } from "./infra/FakeModbusTransport";
