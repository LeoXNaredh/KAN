import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability } from "@kan/plugin-sdk-ts";
import type { MqttConnection, MqttTransportPort } from "./MqttTransportPort";
import { NodeMqttTransport } from "./infra/NodeMqttTransport";

const DISCOVER_TIMEOUT_MS = 3000;

interface TopicCacheEntry {
  lastPayload?: string;
  receivedAt?: string;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function validateTopic(input: unknown): ValidationResult<string> {
  const topic = (input as { topic?: unknown } | null)?.topic;
  if (typeof topic !== "string" || !topic.trim()) return fail("'topic' debe ser un string no vacío");
  return ok(topic);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Nunca loguear/mostrar usuario:contraseña — solo protocolo+host, ver ADR-022. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "broker";
  }
}

function deviceIdFor(url: string): string {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === "mqtts:" ? "8883" : "1883");
    return `mqtt-${parsed.hostname}-${port}`;
  } catch {
    return `mqtt-${url}`;
  }
}

/**
 * `KAN_MQTT_BROKERS`: URLs separadas por coma (mismo patrón que
 * KAN_ESP32_WIFI_HOSTS) — nunca escanea la LAN. Nota: una contraseña con
 * coma en la URL rompe este split; limitación conocida, no vale la pena
 * resolverla hasta que sea un caso real (ver README.md).
 */
function parseBrokerUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * Plugin genérico de MQTT — cliente de un broker existente (Mosquitto,
 * HiveMQ, etc.), no aloja su propio broker (ADR-022). Un "dispositivo" es
 * una conexión a un broker configurado; cada topic al que el usuario se
 * suscribe es un target direccionable por Safety Policy — mismo mecanismo
 * que direcciones BLE / pines ESP32, nunca asumido de antemano (regla 8).
 */
export class MqttDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "mqtt";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-mqtt",
    version: "0.1.0",
    displayName: "MQTT (broker existente)",
    kind: "device-driver",
    runtime: "in-process-ts",
  };

  /** deviceId -> URL completa (con credenciales) — poblado por discover(). */
  private readonly brokerUrls = new Map<string, string>();
  /** deviceId -> conexión viva — borrado en disconnect(). */
  private readonly connections = new Map<string, MqttConnection>();
  /** deviceId -> topic -> último valor — sobrevive disconnect() (mismo criterio que lastScan en plugin-bluetooth-generic). */
  private readonly topicCaches = new Map<string, Map<string, TopicCacheEntry>>();

  constructor(private readonly transport: MqttTransportPort = new NodeMqttTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const urls = parseBrokerUrls(process.env.KAN_MQTT_BROKERS);
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          // Espera el "connect" real de mqtt.js (post-CONNACK) — confirma que
          // hay un broker MQTT de verdad, no solo un puerto TCP abierto.
          const connection = await this.transport.connect(url, { connectTimeoutMs: DISCOVER_TIMEOUT_MS });
          await connection.close();
          const id = deviceIdFor(url);
          this.brokerUrls.set(id, url);
          return { id, name: `Broker MQTT (${redactUrl(url)})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const url = this.brokerUrls.get(deviceId);
    if (!url) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection = await this.transport.connect(url);
    this.connections.set(deviceId, connection);
    if (!this.topicCaches.has(deviceId)) this.topicCaches.set(deviceId, new Map());
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
        name: "subscribe_mqtt",
        description: "Se suscribe a un topic MQTT (soporta wildcards '+'/'#') y empieza a cachear el último valor recibido.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { topic: { type: "string" } },
          required: ["topic"],
        },
        targetParam: "topic",
      }),
      defineCapability({
        name: "unsubscribe_mqtt",
        description: "Deja de escuchar un topic MQTT.",
        severity: "reversible",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { topic: { type: "string" } },
          required: ["topic"],
        },
        targetParam: "topic",
      }),
      defineCapability({
        name: "read_mqtt",
        description: "Devuelve el último valor recibido en un topic suscrito.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { topic: { type: "string" } },
          required: ["topic"],
        },
        targetParam: "topic",
      }),
      defineCapability({
        name: "publish_mqtt",
        description: "Publica un mensaje en un topic MQTT — podría controlar un actuador físico real.",
        severity: "irreversible-material",
        // Sin dry-run posible: no hay forma genérica de previsualizar qué
        // causaría un mensaje en un suscriptor desconocido.
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            payload: { type: "string" },
            qos: { type: "number" },
            retain: { type: "boolean" },
          },
          required: ["topic", "payload"],
        },
        targetParam: "topic",
      }),
      defineCapability({
        name: "list_mqtt_topics",
        description: "Lista los topics suscritos y su último valor conocido.",
        severity: "read-only",
        supportsDryRun: false,
      }),
    ];
  }

  listTargets(deviceId: string): TargetDescriptor[] {
    const cache = this.topicCaches.get(deviceId);
    if (!cache) return [];
    return Array.from(cache.keys()).map((topic) => ({ target: topic, defaultSeverity: "irreversible-material" }));
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.brokerUrls.has(deviceId)) {
      return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    }

    switch (capabilityName) {
      case "subscribe_mqtt": {
        const topic = validateTopic(input);
        if (!topic.ok) return { success: false, error: topic.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          const cache = this.ensureCache(deviceId);
          await connection.subscribe(topic.value, (payload) => {
            cache.set(topic.value, { lastPayload: payload, receivedAt: new Date().toISOString() });
          });
          if (!cache.has(topic.value)) cache.set(topic.value, {});
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "unsubscribe_mqtt": {
        const topic = validateTopic(input);
        if (!topic.ok) return { success: false, error: topic.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          await connection.unsubscribe(topic.value);
          this.topicCaches.get(deviceId)?.delete(topic.value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "read_mqtt": {
        const topic = validateTopic(input);
        if (!topic.ok) return { success: false, error: topic.error };
        const entry = this.topicCaches.get(deviceId)?.get(topic.value);
        if (!entry || entry.lastPayload === undefined) {
          return { success: false, error: "Todavía no llegó ningún mensaje en ese topic." };
        }
        return { success: true, data: { payload: entry.lastPayload, receivedAt: entry.receivedAt } };
      }

      case "publish_mqtt": {
        const topic = validateTopic(input);
        if (!topic.ok) return { success: false, error: topic.error };
        const payload = (input as { payload?: unknown } | null)?.payload;
        if (typeof payload !== "string") return { success: false, error: "'payload' debe ser un string" };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        const qos = (input as { qos?: unknown } | null)?.qos;
        const retain = (input as { retain?: unknown } | null)?.retain;
        try {
          await connection.publish(topic.value, payload, {
            qos: typeof qos === "number" ? (qos as 0 | 1 | 2) : undefined,
            retain: typeof retain === "boolean" ? retain : undefined,
          });
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "list_mqtt_topics": {
        const cache = this.topicCaches.get(deviceId) ?? new Map<string, TopicCacheEntry>();
        return {
          success: true,
          data: {
            topics: Array.from(cache.entries()).map(([topic, entry]) => ({
              topic,
              lastPayload: entry.lastPayload,
              receivedAt: entry.receivedAt,
            })),
          },
        };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private ensureCache(deviceId: string): Map<string, TopicCacheEntry> {
    if (!this.topicCaches.has(deviceId)) this.topicCaches.set(deviceId, new Map());
    return this.topicCaches.get(deviceId)!;
  }
}

export type {
  MqttConnection,
  MqttConnectionState,
  MqttConnectionStateInfo,
  MqttConnectOptions,
  MqttPublishOptions,
  MqttTransportPort,
} from "./MqttTransportPort";
export { NodeMqttTransport, type NodeMqttTransportTuning } from "./infra/NodeMqttTransport";
export { FakeMqttTransport, type FakeMqttBrokerConfig } from "./infra/FakeMqttTransport";
export { matchesTopicFilter } from "./infra/topicMatch";
