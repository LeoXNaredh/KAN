import type { WsConnectOptions, WsConnection, WsConnectionState, WsTransportPort } from "../WsTransportPort";

export interface FakeWsEndpointConfig {
  /** Si es `false`, connect() a esta URL falla (simula un endpoint inalcanzable). */
  reachable?: boolean;
}

type MessageHandler = (payload: string) => void;

/**
 * Servidor WS simulado en memoria para tests del plugin (mismo rol que
 * FakeMqttTransport) — nunca usado para probar el transporte real, eso lo
 * cubre NodeWsTransport.test.ts contra un WebSocketServer real (ADR-012).
 */
export class FakeWsTransport implements WsTransportPort {
  private readonly handlersByUrl = new Map<string, Set<MessageHandler>>();

  constructor(private readonly endpoints: Record<string, FakeWsEndpointConfig> = {}) {}

  async connect(url: string, onMessage: MessageHandler, _options?: WsConnectOptions): Promise<WsConnection> {
    if (this.endpoints[url]?.reachable === false) {
      throw new Error(`No se pudo conectar a ${url}`);
    }

    if (!this.handlersByUrl.has(url)) this.handlersByUrl.set(url, new Set());
    this.handlersByUrl.get(url)!.add(onMessage);

    let state: WsConnectionState = "connected";

    return {
      get state() {
        return state;
      },
      send: async () => {
        if (state !== "connected") throw new Error(`No se puede mandar: conexión WS "${state}"`);
      },
      close: async () => {
        state = "disconnected";
        this.handlersByUrl.get(url)?.delete(onMessage);
      },
    };
  }

  /** Simula un mensaje entrante del servidor — para tests. */
  simulateIncoming(url: string, payload: string): void {
    this.handlersByUrl.get(url)?.forEach((handler) => handler(payload));
  }
}
