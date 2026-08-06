import WebSocket from "ws";
import type { CoreToEdgeMessage, EdgeToCoreMessage } from "@kan/plugin-contract";
import type { CoreConnectionPort, CoreConnectionStatus } from "../domain/ports/CoreConnectionPort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "../application/EdgeAgentBus";

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Conexión saliente y persistente hacia el Core Cloud (requisito 8;
 * docs/07-arquitectura-comunicacion.md sección 2: siempre saliente desde el
 * Edge Agent, nunca al revés). Sin un servidor real todavía (ADR-009,
 * incremento siguiente), esto queda reintentando con backoff exponencial —
 * comportamiento correcto que además demuestra el Modo Offline (requisito 14):
 * nada más en el Edge Agent depende de que esta conexión exista.
 */
export class CoreWebSocketClient implements CoreConnectionPort {
  private ws: WebSocket | undefined;
  private _status: CoreConnectionStatus = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readonly messageHandlers: Array<(message: CoreToEdgeMessage) => void> = [];
  private readonly statusHandlers: Array<(status: CoreConnectionStatus) => void> = [];
  private stopped = true;

  constructor(
    private readonly url: string,
    private readonly authToken: string,
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
  ) {}

  get status(): CoreConnectionStatus {
    return this._status;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.setStatus("disconnected");
  }

  send(message: EdgeToCoreMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (message: CoreToEdgeMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onStatusChange(handler: (status: CoreConnectionStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  private connect(): void {
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    try {
      this.ws = new WebSocket(this.url, { headers: { authorization: `Bearer ${this.authToken}` } });
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.logger.info("Conectado al Core Cloud");
      this.heartbeatTimer = setInterval(() => {
        this.send({ type: "heartbeat", at: new Date().toISOString() });
      }, HEARTBEAT_INTERVAL_MS);
    });

    this.ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as CoreToEdgeMessage;
        this.messageHandlers.forEach((handler) => handler(message));
      } catch {
        this.logger.warn("Mensaje inválido recibido del Core");
      }
    });

    this.ws.on("close", () => {
      clearInterval(this.heartbeatTimer);
      if (!this.stopped) this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      // El evento "close" se dispara justo después; evitamos loguear dos veces.
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus("reconnecting");
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: CoreConnectionStatus): void {
    this._status = status;
    this.bus.emit("core.status", { status });
    this.statusHandlers.forEach((handler) => handler(status));
  }
}
