import type { CoreToEdgeMessage, EdgeToCoreMessage } from "@kan/plugin-contract/browser";
import type { CoreConnectionPort, CoreConnectionStatus, Unsubscribe } from "../../domain/ports/CoreConnectionPort";
import type { LoggerPort } from "../../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "../../application/EdgeAgentBus";

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Equivalente de `CoreWebSocketClient` para el navegador (el Simulador
 * corriendo en `apps/web`). Dos diferencias de fondo con la versión Node:
 *
 * 1. Usa el `WebSocket` global del navegador, no el paquete `ws` — y ese
 *    `WebSocket` nativo no puede mandar headers custom en el handshake, así
 *    que no hay forma de autenticar con `Authorization: Bearer <token>`.
 * 2. Por eso la auth viaja por query string como un ticket de un solo uso
 *    (`WsConnectionManager` del Gateway, camino de ticket) — y como los
 *    tickets expiran en 60s y se consumen al primer uso, hace falta pedir
 *    uno nuevo en CADA intento de conexión, no solo una vez al construir
 *    este cliente. `fetchTicketUrl` hace ese pedido (típicamente un POST a
 *    `/api/edge-ticket` en apps/web) y devuelve la URL completa del WS ya
 *    con el ticket puesto.
 */
export class BrowserWebSocketClient implements CoreConnectionPort {
  private ws: WebSocket | undefined;
  private _status: CoreConnectionStatus = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readonly messageHandlers: Array<(message: CoreToEdgeMessage) => void> = [];
  private readonly statusHandlers: Array<(status: CoreConnectionStatus) => void> = [];
  private stopped = true;

  constructor(
    private readonly fetchTicketUrl: () => Promise<string>,
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
  ) {}

  get status(): CoreConnectionStatus {
    return this._status;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
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

  onMessage(handler: (message: CoreToEdgeMessage) => void): Unsubscribe {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index !== -1) this.messageHandlers.splice(index, 1);
    };
  }

  onStatusChange(handler: (status: CoreConnectionStatus) => void): Unsubscribe {
    this.statusHandlers.push(handler);
    return () => {
      const index = this.statusHandlers.indexOf(handler);
      if (index !== -1) this.statusHandlers.splice(index, 1);
    };
  }

  private async connect(): Promise<void> {
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    let url: string;
    try {
      url = await this.fetchTicketUrl();
    } catch (error) {
      this.logger.warn(`No se pudo obtener un ticket de conexión: ${error instanceof Error ? error.message : error}`);
      this.scheduleReconnect();
      return;
    }

    if (this.stopped) return; // stop() pudo llamarse mientras esperábamos el ticket

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.logger.info("Conectado al Core Cloud");
      this.heartbeatTimer = setInterval(() => {
        this.send({ type: "heartbeat", at: new Date().toISOString() });
      }, HEARTBEAT_INTERVAL_MS);
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as CoreToEdgeMessage;
        this.messageHandlers.forEach((handler) => handler(message));
      } catch {
        this.logger.warn("Mensaje inválido recibido del Core");
      }
    });

    this.ws.addEventListener("close", () => {
      clearInterval(this.heartbeatTimer);
      if (!this.stopped) this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      // El evento "close" se dispara justo después y ya dispara el reconnect.
      this.logger.warn("Error en la conexión al Core Cloud");
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus("reconnecting");
    const baseDelay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    // Jitter: evita que múltiples tabs reconecten todos en el mismo instante tras una caída del Gateway.
    const delay = baseDelay / 2 + Math.random() * (baseDelay / 2);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private setStatus(status: CoreConnectionStatus): void {
    this._status = status;
    this.bus.emit("core.status", { status });
    this.statusHandlers.forEach((handler) => handler(status));
  }
}
