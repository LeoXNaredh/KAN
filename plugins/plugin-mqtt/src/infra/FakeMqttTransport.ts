import type {
  MqttConnection,
  MqttConnectionState,
  MqttConnectionStateInfo,
  MqttConnectOptions,
  MqttTransportPort,
} from "../MqttTransportPort";

export interface FakeMqttBrokerConfig {
  /** Si es `false`, connect() a esta URL falla (simula un broker inalcanzable). */
  reachable?: boolean;
}

type TopicHandler = (payload: string, topic: string) => void;

/**
 * Broker MQTT simulado en memoria para tests del plugin (mismo rol que
 * FakeBluetoothTransport) — nunca usado para probar el transporte real, eso
 * lo cubre NodeTcpTransport.test.ts-equivalente (NodeMqttTransport.test.ts)
 * contra un broker `aedes` real, per ADR-012.
 */
export class FakeMqttTransport implements MqttTransportPort {
  private readonly subscribersByUrl = new Map<string, Map<string, Set<TopicHandler>>>();

  constructor(private readonly brokers: Record<string, FakeMqttBrokerConfig> = {}) {}

  async connect(brokerUrl: string, _options?: MqttConnectOptions): Promise<MqttConnection> {
    if (this.brokers[brokerUrl]?.reachable === false) {
      throw new Error(`No se pudo conectar al broker ${brokerUrl}`);
    }

    if (!this.subscribersByUrl.has(brokerUrl)) this.subscribersByUrl.set(brokerUrl, new Map());
    const topics = this.subscribersByUrl.get(brokerUrl)!;
    const mySubs = new Set<string>();
    let closed = false;
    let state: MqttConnectionState = "connected";

    return {
      get state() {
        return state;
      },
      publish: async (topic, payload) => {
        if (closed) throw new Error("Conexión MQTT cerrada");
        topics.get(topic)?.forEach((handler) => handler(payload, topic));
      },
      subscribe: async (topic, handler) => {
        if (closed) throw new Error("Conexión MQTT cerrada");
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic)!.add(handler);
        mySubs.add(topic);
      },
      unsubscribe: async (topic) => {
        topics.get(topic)?.clear();
        mySubs.delete(topic);
      },
      onStateChange: (_handler: (info: MqttConnectionStateInfo) => void) => () => {},
      close: async () => {
        closed = true;
        state = "disconnected";
        mySubs.forEach((topic) => topics.get(topic)?.clear());
      },
    };
  }

  /** Simula un mensaje externo llegando a un topic (ej. un sensor real publicando) — para tests. */
  simulateIncoming(brokerUrl: string, topic: string, payload: string): void {
    this.subscribersByUrl.get(brokerUrl)?.get(topic)?.forEach((handler) => handler(payload, topic));
  }
}
