import { WebSocket } from "ws";
import type { WsConnectOptions, WsConnection, WsConnectionState, WsTransportPort } from "../WsTransportPort";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Sin reconexión automática a propósito (a diferencia de mqtt.js/ADR-022) —
 * simplicidad deliberada para un primer corte de un plugin genérico, ver
 * README. Si se corta, queda "disconnected" hasta que se llame a
 * connect() de nuevo.
 */
class NodeWsConnection implements WsConnection {
  private _state: WsConnectionState = "connected";

  constructor(private readonly socket: WebSocket) {
    socket.on("close", () => {
      this._state = "disconnected";
    });
    // Nunca dejar 'error' sin manejar — tumbaría el proceso entero.
    socket.on("error", (error) => {
      console.error("[NodeWsTransport] error de conexión:", error.message);
    });
  }

  get state(): WsConnectionState {
    return this._state;
  }

  async send(payload: string): Promise<void> {
    if (this._state !== "connected") throw new Error(`No se puede mandar: conexión WS "${this._state}"`);
    await new Promise<void>((resolve, reject) => {
      this.socket.send(payload, (error) => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    this._state = "disconnected";
    this.socket.close();
  }
}

export class NodeWsTransport implements WsTransportPort {
  connect(url: string, onMessage: (payload: string) => void, options?: WsConnectOptions): Promise<WsConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: options?.header ? { [options.header.name]: options.header.value } : undefined,
        handshakeTimeout: options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      });

      let settled = false;

      // Permanente desde el arranque, no `.once` — mismo cuidado que
      // NodeMqttTransport: un EventEmitter sin listener de "error" tumba el
      // proceso. Una vez resuelto, queda como no-op; NodeWsConnection
      // agrega el suyo propio (con logging real) desde "open".
      socket.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      socket.once("open", () => {
        if (settled) return;
        settled = true;
        socket.on("message", (data) => onMessage(data.toString()));
        resolve(new NodeWsConnection(socket));
      });
    });
  }
}
