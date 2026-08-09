import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { WsConnection, WsHeader, WsTransportPort } from "./WsTransportPort";
import { NodeWsTransport } from "./infra/NodeWsTransport";

const DISCOVER_TIMEOUT_MS = 3000;
const MAX_BUFFERED_MESSAGES = 50;

interface EndpointConfig {
  name: string;
  url: string;
  header: WsHeader | undefined;
}

interface BufferedMessage {
  payload: string;
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
  return `ws_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function parseHeader(raw: string): WsHeader | undefined {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) return undefined;
  return { name: raw.slice(0, separatorIndex).trim(), value: raw.slice(separatorIndex + 1).trim() };
}

/**
 * `KAN_WS_ENDPOINTS`: `nombre|wsUrl|Header:valor` separados por coma (el
 * header es opcional) — mismo formato, mismo criterio "nunca escanea" y
 * mismas limitaciones conocidas que KAN_HTTP_ENDPOINTS/KAN_MQTT_BROKERS.
 */
function parseEndpoints(raw: string | undefined): EndpointConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, url, headerPart] = entry.split("|").map((part) => part?.trim());
      return { name, url, header: headerPart ? parseHeader(headerPart) : undefined };
    })
    .filter((config): config is EndpointConfig => Boolean(config.name && config.url));
}

function validatePayload(input: unknown): ValidationResult<string> {
  const payload = (input as { payload?: unknown } | null)?.payload;
  if (typeof payload !== "string") return fail("'payload' debe ser un string");
  return ok(payload);
}

/**
 * Plugin genérico de WebSocket — cliente de endpoints ya configurados,
 * nunca uno elegido por la IA o el usuario en la conversación (misma
 * defensa contra SSRF que plugin-http-generic). Un "dispositivo" es una
 * conexión WS configurada. A diferencia de MQTT, un WebSocket no tiene
 * topics — el canal es el dispositivo entero, así que no expone targets
 * (mismo caso que plugin-device-simulator, sin nada que direccionar).
 */
export class WsDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "ws-generic";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-ws-generic",
    version: "0.1.0",
    displayName: "WebSocket (endpoint configurado)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["ws-generic"], network: true, filesystem: [] }),
  };

  private readonly endpoints = new Map<string, EndpointConfig>();
  private readonly connections = new Map<string, WsConnection>();
  private readonly messageBuffers = new Map<string, BufferedMessage[]>();

  constructor(private readonly transport: WsTransportPort = new NodeWsTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseEndpoints(process.env.KAN_WS_ENDPOINTS);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          // Conecta y cierra enseguida solo para confirmar que hay un
          // servidor WS real ahí — mismo criterio que discover() en
          // plugin-mqtt (post-CONNACK) y plugin-http-generic (GET real).
          const connection = await this.transport.connect(config.url, () => {}, {
            connectTimeoutMs: DISCOVER_TIMEOUT_MS,
            header: config.header,
          });
          await connection.close();
          const id = sanitizeDeviceId(config.name);
          this.endpoints.set(id, config);
          return { id, name: `WebSocket (${config.name}, ${hostOf(config.url)})`, kind: this.kind };
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

    const buffer = this.ensureBuffer(deviceId);
    const connection = await this.transport.connect(
      config.url,
      (payload) => {
        buffer.push({ payload, receivedAt: new Date().toISOString() });
        if (buffer.length > MAX_BUFFERED_MESSAGES) buffer.shift();
      },
      { header: config.header },
    );
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
        name: "send_ws_message",
        description: "Manda un mensaje de texto por el WebSocket — podría provocar un efecto real del otro lado.",
        severity: "irreversible-material",
        // Sin dry-run posible: no hay forma genérica de previsualizar qué
        // causaría un mensaje en un servidor desconocido (mismo motivo que publish_mqtt).
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { payload: { type: "string" } },
          required: ["payload"],
        },
      }),
      defineCapability({
        name: "read_ws_messages",
        description: `Devuelve los últimos hasta ${MAX_BUFFERED_MESSAGES} mensajes recibidos por este WebSocket.`,
        severity: "read-only",
        supportsDryRun: false,
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.endpoints.has(deviceId)) {
      return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    }

    switch (capabilityName) {
      case "send_ws_message": {
        const payload = validatePayload(input);
        if (!payload.ok) return { success: false, error: payload.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          await connection.send(payload.value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "read_ws_messages": {
        const buffer = this.messageBuffers.get(deviceId) ?? [];
        return { success: true, data: { messages: buffer } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private ensureBuffer(deviceId: string): BufferedMessage[] {
    if (!this.messageBuffers.has(deviceId)) this.messageBuffers.set(deviceId, []);
    return this.messageBuffers.get(deviceId)!;
  }
}

export type { WsConnection, WsConnectionState, WsConnectOptions, WsHeader, WsTransportPort } from "./WsTransportPort";
export { NodeWsTransport } from "./infra/NodeWsTransport";
export { FakeWsTransport, type FakeWsEndpointConfig } from "./infra/FakeWsTransport";
