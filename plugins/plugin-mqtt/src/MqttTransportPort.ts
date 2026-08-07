/**
 * Abstracción de un cliente MQTT (conectar a un broker existente, publicar,
 * suscribirse). Igual que BluetoothTransportPort/NetworkTransportPort en los
 * plugins hermanos: testeable sin un broker real con un fake (ver
 * infra/FakeMqttTransport.ts). La implementación real vive en
 * infra/NodeMqttTransport.ts sobre el paquete `mqtt` (puro JS).
 */
export type MqttConnectionState = "connected" | "reconnecting" | "disconnected";

export interface MqttConnectionStateInfo {
  state: MqttConnectionState;
  /** 0 mientras "connected". Cuenta los intentos de reconexión en curso. */
  reconnectAttempt: number;
  /** ISO 8601 — se fija al entrar en "reconnecting", se limpia al reconectar. */
  unreachableSince?: string;
}

export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export interface MqttConnection {
  readonly state: MqttConnectionState;
  publish(topic: string, payload: string, options?: MqttPublishOptions): Promise<void>;
  subscribe(topic: string, handler: (payload: string, topic: string) => void): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  onStateChange(handler: (info: MqttConnectionStateInfo) => void): () => void;
  close(): Promise<void>;
}

export interface MqttConnectOptions {
  connectTimeoutMs?: number;
}

export interface MqttTransportPort {
  connect(brokerUrl: string, options?: MqttConnectOptions): Promise<MqttConnection>;
}
