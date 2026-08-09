/**
 * Abstracción de una conexión WebSocket a un endpoint ya configurado (nunca
 * uno arbitrario elegido en la conversación — ver README). Igual que
 * MqttTransportPort/HttpTransportPort en los plugins hermanos: testeable
 * sin red real con un fake (ver infra/FakeWsTransport.ts). La
 * implementación real (infra/NodeWsTransport.ts) usa el paquete `ws`, ya
 * dependencia del proyecto (apps/gateway, packages/gateway-core).
 */
export type WsConnectionState = "connected" | "disconnected";

export interface WsConnection {
  readonly state: WsConnectionState;
  send(payload: string): Promise<void>;
  close(): Promise<void>;
}

export interface WsHeader {
  name: string;
  value: string;
}

export interface WsConnectOptions {
  connectTimeoutMs?: number;
  header?: WsHeader;
}

export interface WsTransportPort {
  connect(url: string, onMessage: (payload: string) => void, options?: WsConnectOptions): Promise<WsConnection>;
}
