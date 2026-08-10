import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  SIDECAR_PROTOCOL_VERSION,
  type SidecarRequestInput,
  type SidecarRequestMessage,
  type SidecarToEdgeMessage,
} from "@kan/plugin-contract";

const HELLO_TIMEOUT_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface PendingRequest {
  resolve: (message: SidecarToEdgeMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function majorVersion(version: string): string {
  return version.split(".")[0] ?? version;
}

/**
 * WS server efímero en `127.0.0.1:0`, uno por proceso sidecar (ADR-056) —
 * nunca compartido entre plugins, refuerza el aislamiento de ADR-003: un
 * sidecar comprometido nunca ve tráfico de otro plugin. Estructuralmente
 * calcado de `WsConnectionManager` (hello-timeout, heartbeat-timeout,
 * ignorar mensajes con forma inesperada sin tumbar la conexión — hallazgo
 * M5 de docs/13), pero para una sola conexión saliente esperada, no muchas.
 */
export class SidecarWsHost {
  private readonly wss: WebSocketServer;
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private helloWaiters: Array<(error?: Error) => void> = [];
  private helloReceived = false;
  private lastHeartbeatAt = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readonly closedHandlers: Array<() => void> = [];

  constructor(
    private readonly pluginId: string,
    private readonly token: string,
  ) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  }

  /** Abre el puerto y empieza a aceptar la única conexión esperada. Llamar antes de spawnear el proceso hijo. */
  async start(): Promise<{ port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.wss.once("listening", () => resolve());
      this.wss.once("error", reject);
    });
    this.wss.on("connection", (socket) => this.onConnection(socket));

    const address = this.wss.address();
    if (typeof address === "string" || address === null) {
      throw new Error("No se pudo determinar el puerto del SidecarWsHost.");
    }
    return { port: address.port };
  }

  /** Se resuelve cuando el handshake `sidecar_hello` es válido; rechaza en timeout, handshake inválido, o si el socket se cierra antes. */
  waitForHello(timeoutMs: number = HELLO_TIMEOUT_MS): Promise<void> {
    if (this.helloReceived) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.helloWaiters = this.helloWaiters.filter((waiter) => waiter !== settle);
        reject(new Error(`No se recibió sidecar_hello dentro de ${timeoutMs}ms.`));
      }, timeoutMs);

      const settle = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      this.helloWaiters.push(settle);
    });
  }

  /** Manda un request correlacionado por `requestId` y espera la respuesta. */
  request<T extends SidecarToEdgeMessage>(message: SidecarRequestInput, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("El sidecar no está conectado."));
    }

    const requestId = randomUUID();
    const full = { ...message, requestId } as SidecarRequestMessage;
    const socket = this.socket;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timeout esperando respuesta a "${full.type}".`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve: resolve as (m: SidecarToEdgeMessage) => void, reject, timer });
      socket.send(JSON.stringify(full));
    });
  }

  /** Apagado ordenado — no espera respuesta, el proceso hijo cierra el socket él mismo tras `on_unload()`. */
  sendShutdown(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "shutdown" }));
    }
  }

  onClosed(handler: () => void): void {
    this.closedHandlers.push(handler);
  }

  close(): void {
    this.stopHeartbeatWatch();
    this.socket?.close();
    this.wss.close();
  }

  private onConnection(socket: WebSocket): void {
    if (this.socket) {
      socket.close(4000, "ya hay una conexión activa");
      return;
    }
    this.socket = socket;
    socket.on("message", (raw) => this.onMessage(raw));
    socket.on("close", () => this.onSocketClosed());
    this.startHeartbeatWatch();
  }

  private onMessage(raw: unknown): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return; // forma inesperada — se ignora sin tumbar la conexión (mismo criterio que WsConnectionManager)
    }

    if (!this.helloReceived) {
      if (message.type === "sidecar_hello") this.handleHello(message);
      return; // cualquier otra cosa antes del hello se ignora
    }

    if (message.type === "heartbeat") {
      this.lastHeartbeatAt = Date.now();
      return;
    }

    if (typeof message.requestId === "string") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve(message as unknown as SidecarToEdgeMessage);
    }
  }

  private handleHello(message: Record<string, unknown>): void {
    const validToken = message.token === this.token;
    const validPlugin = message.pluginId === this.pluginId;
    const validVersion =
      typeof message.protocolVersion === "string" &&
      majorVersion(message.protocolVersion) === majorVersion(SIDECAR_PROTOCOL_VERSION);

    if (!validToken || !validPlugin || !validVersion) {
      this.socket?.close(4001, "handshake inválido");
      this.settleHelloWaiters(new Error("Handshake de sidecar inválido (token/pluginId/protocolVersion)."));
      return;
    }

    this.helloReceived = true;
    this.lastHeartbeatAt = Date.now();
    this.socket?.send(JSON.stringify({ type: "sidecar_hello_ack", ok: true }));
    this.settleHelloWaiters();
  }

  private settleHelloWaiters(error?: Error): void {
    const waiters = this.helloWaiters;
    this.helloWaiters = [];
    for (const waiter of waiters) waiter(error);
  }

  private onSocketClosed(): void {
    this.stopHeartbeatWatch();
    if (!this.helloReceived) {
      this.settleHelloWaiters(new Error("La conexión del sidecar se cerró antes de completar el handshake."));
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("La conexión del sidecar se cerró."));
    }
    this.pending.clear();
    this.socket = undefined;
    for (const handler of this.closedHandlers) handler();
  }

  private startHeartbeatWatch(): void {
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        this.socket?.close(4002, "heartbeat perdido");
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private stopHeartbeatWatch(): void {
    clearInterval(this.heartbeatTimer);
  }
}
