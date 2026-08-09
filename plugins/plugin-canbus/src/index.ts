import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { CanbusConnection, CanbusTransportPort } from "./CanbusTransportPort";
import { SlcanTransport } from "./infra/SlcanTransport";
import { SLCAN_BITRATE_TO_CODE, type CanFrame } from "./SlcanCodec";

const DEFAULT_BITRATE = 500_000;
const MAX_BUFFERED_FRAMES = 50;
const MAX_DATA_BYTES = 8;

interface ChannelConfig {
  name: string;
  path: string;
  bitrate: number;
}

interface BufferedFrame {
  canId: number;
  extended: boolean;
  data: number[];
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
  return `canbus_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * `KAN_CANBUS_TARGETS`: `nombre|puerto|bitrate` separados por coma —
 * bitrate opcional en bit/s (default 500000, el más común en CAN
 * automotriz/industrial — OBD-II y CANopen suelen usarlo). Mismo criterio
 * "nunca escanea" que el resto de KAN_*_TARGETS: mandar tramas a un bus
 * CAN desconocido puede accionar hardware real (frenos, actuadores
 * industriales) — riesgo real, no hipotético.
 */
function parseTargets(raw: string | undefined): ChannelConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): ChannelConfig | undefined => {
      const [name, path, bitrateStr] = entry.split("|").map((part) => part?.trim());
      if (!name || !path) return undefined;
      const bitrate = bitrateStr ? Number(bitrateStr) : DEFAULT_BITRATE;
      if (!SLCAN_BITRATE_TO_CODE.has(bitrate)) return undefined;
      return { name, path, bitrate };
    })
    .filter((config): config is ChannelConfig => config !== undefined);
}

function validateSendFrameInput(input: unknown): ValidationResult<CanFrame> {
  const body = input as { canId?: unknown; data?: unknown; extended?: unknown } | null;
  const canId = body?.canId;
  if (typeof canId !== "number" || !Number.isInteger(canId) || canId < 0) {
    return fail("'canId' debe ser un entero no negativo");
  }

  const data = body?.data;
  if (!Array.isArray(data) || data.length > MAX_DATA_BYTES) {
    return fail(`'data' debe ser un array de hasta ${MAX_DATA_BYTES} bytes`);
  }
  if (!data.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 0xff)) {
    return fail("cada byte de 'data' debe ser un entero entre 0 y 255");
  }

  const extended = body?.extended;
  if (extended !== undefined && typeof extended !== "boolean") return fail("'extended' debe ser boolean si se manda");

  return ok({ canId, data: data as number[], extended: extended === true });
}

/**
 * Plugin de CAN Bus (vehículos e industrial) sobre adaptadores USB-CAN
 * baratos (CANable, CANtact, USBtin, CANUSB) vía el protocolo SLCAN/Lawicel
 * — texto ASCII sobre un puerto serial estándar. Sin ninguna librería de
 * CAN Bus ni binding nativo: el adaptador se enumera como un puerto
 * COM/tty normal (igual que cualquier USB-serial) y este plugin arma/parsea
 * el framing SLCAN (`SlcanCodec`) encima de `@kan/serial-line-transport`
 * (el mismo transporte real que ya usan plugin-esp32-arduino/plugin-gcode/
 * plugin-serial-generic) — decisión explícita documentada en ADR-052:
 * las alternativas con soporte Windows real (`cs-pcan-usb` para hardware
 * PEAK específico) requieren un binding N-API nativo por vendor, mientras
 * que SLCAN es un protocolo de texto abierto que cualquier adaptador
 * SLCAN-compatible habla sin instalar nada más.
 *
 * Sin targets — mismo caso que plugin-ws-generic/plugin-serial-generic:
 * un canal CAN entero es el target implícito a nivel dispositivo (no hay
 * sub-canales, `canId` es el target de `send_frame` a nivel capability).
 */
export class CanbusDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "canbus";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-canbus",
    version: "0.1.0",
    displayName: "CAN Bus (SLCAN)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["canbus"], network: false, filesystem: [] }),
  };

  private readonly channels = new Map<string, ChannelConfig>();
  private readonly connections = new Map<string, CanbusConnection>();
  private readonly buffers = new Map<string, BufferedFrame[]>();

  constructor(private readonly transport: CanbusTransportPort = new SlcanTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseTargets(process.env.KAN_CANBUS_TARGETS);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          const connection = await this.transport.openChannel(config.path, config.bitrate);
          await connection.close();
          const id = sanitizeDeviceId(config.name);
          this.channels.set(id, config);
          return { id, name: `CAN Bus (${config.name}, ${config.path}@${config.bitrate}bps)`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const config = this.channels.get(deviceId);
    if (!config) throw new Error(`Dispositivo desconocido: ${deviceId}`);

    const buffer = this.ensureBuffer(deviceId);
    const connection = await this.transport.openChannel(config.path, config.bitrate);
    connection.onFrame((frame) => {
      buffer.push({ ...frame, receivedAt: new Date().toISOString() });
      if (buffer.length > MAX_BUFFERED_FRAMES) buffer.shift();
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
        name: "send_frame",
        description: "Transmite una trama CAN (canId + data) al bus — puede accionar hardware real conectado al bus.",
        severity: "irreversible-material",
        targetParam: "canId",
        // Sin dry-run posible: el efecto de una trama depende de qué nodo del
        // bus la interprete, no hay forma genérica de previsualizarlo (mismo
        // motivo que send_line/publish_mqtt/send_ws_message).
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: {
            canId: { type: "number" },
            data: { type: "array", items: { type: "number" }, maxItems: MAX_DATA_BYTES },
            extended: { type: "boolean" },
          },
          required: ["canId", "data"],
        },
      }),
      defineCapability({
        name: "read_last_frames",
        description: `Devuelve las últimas hasta ${MAX_BUFFERED_FRAMES} tramas recibidas del bus.`,
        severity: "read-only",
        supportsDryRun: false,
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.channels.has(deviceId)) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };

    switch (capabilityName) {
      case "send_frame": {
        const frame = validateSendFrameInput(input);
        if (!frame.ok) return { success: false, error: frame.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          await connection.sendFrame(frame.value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "read_last_frames": {
        const frames = this.buffers.get(deviceId) ?? [];
        return { success: true, data: { frames } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private ensureBuffer(deviceId: string): BufferedFrame[] {
    if (!this.buffers.has(deviceId)) this.buffers.set(deviceId, []);
    return this.buffers.get(deviceId)!;
  }
}

export { SlcanTransport } from "./infra/SlcanTransport";
export type { CanbusConnection, CanbusTransportPort } from "./CanbusTransportPort";
export { bitrateToSlcanCommand, decodeFrame, encodeFrame, SLCAN_BITRATE_TO_CODE, type CanFrame } from "./SlcanCodec";
export { FakeCanbusTransport, type FakeChannelConfig } from "./infra/FakeCanbusTransport";
