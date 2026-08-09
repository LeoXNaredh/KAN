import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import { NodeSerialTransport, type SerialConnection, type SerialTransportPort } from "@kan/serial-line-transport";

const DEFAULT_BAUD_RATE = 9600;
const MAX_BUFFERED_LINES = 50;

interface PortConfig {
  name: string;
  path: string;
  baudRate: number;
}

interface BufferedLine {
  line: string;
  receivedAt: string;
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
  return `serial_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * `KAN_SERIAL_TARGETS`: `nombre|puerto|baudRate` separados por coma —
 * baudRate opcional (default 9600, el más universal en RS-232/USB-serial
 * clásico). Mismo criterio "nunca escanea" que el resto de
 * KAN_*_TARGETS — a diferencia de plugin-esp32-arduino (que puede escanear
 * porque su propio firmware responde un ping inofensivo), un dispositivo
 * serial genérico no tiene protocolo fijo: mandarle bytes a un puerto
 * desconocido es un riesgo real, mismo motivo que ya documentó
 * plugin-gcode para no escanear.
 */
function parseTargets(raw: string | undefined): PortConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): PortConfig | undefined => {
      const [name, path, baudStr] = entry.split("|").map((part) => part?.trim());
      if (!name || !path) return undefined;
      const baudRate = baudStr ? Number(baudStr) : DEFAULT_BAUD_RATE;
      if (!Number.isFinite(baudRate)) return undefined;
      return { name, path, baudRate };
    })
    .filter((config): config is PortConfig => config !== undefined);
}

function validateLine(input: unknown): ValidationResult<string> {
  const line = (input as { line?: unknown } | null)?.line;
  if (typeof line !== "string") return fail("'line' debe ser un string");
  return ok(line);
}

/**
 * Plugin de puerto serial genérico — para cualquier dispositivo que hable
 * ASCII/texto línea por línea sobre COM/ttyUSB y no tenga un protocolo
 * fijo cubierto por otro plugin (ESP32, G-code, Modbus RTU). Reusa
 * `@kan/serial-line-transport` (extraído de plugin-esp32-arduino,
 * compartido con plugin-gcode) — mismo transporte real, sin duplicar
 * `serialport` de nuevo.
 *
 * Sin targets — mismo caso que plugin-ws-generic: un puerto serial
 * genérico no tiene sub-canales direccionables, el dispositivo entero es
 * el target implícito.
 */
export class SerialGenericDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "serial-generic";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-serial-generic",
    version: "0.1.0",
    displayName: "Puerto serial genérico",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["serial-generic"], network: false, filesystem: [] }),
  };

  private readonly ports = new Map<string, PortConfig>();
  private readonly connections = new Map<string, SerialConnection>();
  private readonly buffers = new Map<string, BufferedLine[]>();

  constructor(private readonly transport: SerialTransportPort = new NodeSerialTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseTargets(process.env.KAN_SERIAL_TARGETS);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          const connection = await this.transport.open(config.path, config.baudRate);
          await connection.close();
          const id = sanitizeDeviceId(config.name);
          this.ports.set(id, config);
          return { id, name: `Serial (${config.name}, ${config.path}@${config.baudRate})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const config = this.ports.get(deviceId);
    if (!config) throw new Error(`Dispositivo desconocido: ${deviceId}`);

    const buffer = this.ensureBuffer(deviceId);
    const connection = await this.transport.open(config.path, config.baudRate);
    connection.onLine((line) => {
      buffer.push({ line, receivedAt: new Date().toISOString() });
      if (buffer.length > MAX_BUFFERED_LINES) buffer.shift();
    });
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
        name: "send_line",
        description: "Manda una línea de texto por el puerto serial — podría provocar un efecto físico real.",
        severity: "irreversible-material",
        // Sin dry-run posible: no hay forma genérica de previsualizar qué
        // causaría una línea en un dispositivo desconocido (mismo motivo
        // que publish_mqtt/send_ws_message).
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { line: { type: "string" } }, required: ["line"] },
      }),
      defineCapability({
        name: "read_last_lines",
        description: `Devuelve las últimas hasta ${MAX_BUFFERED_LINES} líneas recibidas por este puerto.`,
        severity: "read-only",
        supportsDryRun: false,
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.ports.has(deviceId)) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };

    switch (capabilityName) {
      case "send_line": {
        const line = validateLine(input);
        if (!line.ok) return { success: false, error: line.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          connection.write(line.value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "read_last_lines": {
        const lines = this.buffers.get(deviceId) ?? [];
        return { success: true, data: { lines } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private ensureBuffer(deviceId: string): BufferedLine[] {
    if (!this.buffers.has(deviceId)) this.buffers.set(deviceId, []);
    return this.buffers.get(deviceId)!;
  }
}

export { NodeSerialTransport, type SerialConnection, type SerialTransportPort } from "@kan/serial-line-transport";
export { FakeSerialTransport, type FakePortConfig } from "./infra/FakeSerialTransport";
