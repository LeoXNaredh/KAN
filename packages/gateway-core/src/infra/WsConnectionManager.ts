import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  PROTOCOL_VERSION,
  safeCompareToken,
  type CoreToEdgeMessage,
  type EdgeToCoreMessage,
  type HelloMessage,
} from "@kan/plugin-contract";
import type { PairingPort } from "@kan/core";
import type { AgentConnectionInfo, ConnectionManagerPort, Unsubscribe } from "../domain/ports/ConnectionManagerPort";

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const REAPER_INTERVAL_MS = 10_000;
/** Los mensajes reales del protocolo son pequeños; evita que un socket envíe payloads gigantes (hallazgo A9 de docs/13). */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/**
 * Cap global de conexiones concurrentes (docs/16 P6, ADR-025) — hoy solo
 * existe un único token compartido para todo el Gateway (sin identidad por
 * agente a nivel de auth), así que este es un límite global de recursos, no
 * "por token" literal. Protege contra sockets que pasan el auth pero nunca
 * completan `hello`, o simplemente contra demasiadas conexiones a la vez.
 */
const DEFAULT_MAX_CONNECTIONS = 50;

interface TrackedConnection {
  socket: WebSocket;
  edgeAgentId?: string;
  ownerId?: string;
  lastSeen: number;
  helloTimer?: ReturnType<typeof setTimeout>;
  /**
   * `onHello()` es async (resuelve el `ownerId` antes de terminar, docs/19
   * P2 incremento 3) — este flag cubre la ventana entre que llega un
   * "hello" y que `conn.edgeAgentId` queda seteado, para que un segundo
   * "hello" en esa ventana siga detectándose como duplicado (hallazgo A4
   * de docs/13, antes garantizado gratis por ser todo síncrono).
   */
  helloInFlight?: boolean;
}

function majorVersion(version: string): string {
  return version.split(".")[0] ?? version;
}

function removeHandler<T>(list: T[], handler: T): void {
  const index = list.indexOf(handler);
  if (index !== -1) list.splice(index, 1);
}

/**
 * Único módulo que toca el transporte WebSocket real (docs/12 §1). Corre en
 * modo `noServer`: quien controla el `http.Server` (apps/gateway) decide
 * cuándo delegarle un `upgrade` vía `handleUpgrade()`, para poder compartir
 * el mismo puerto con la API HTTP.
 */
export class WsConnectionManager implements ConnectionManagerPort {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private readonly byAgentId = new Map<string, TrackedConnection>();
  private readonly pending = new Set<TrackedConnection>();
  private readonly connectedHandlers: Array<(info: AgentConnectionInfo) => void> = [];
  private readonly disconnectedHandlers: Array<(edgeAgentId: string) => void> = [];
  private readonly messageHandlers: Array<(edgeAgentId: string, message: EdgeToCoreMessage) => void> = [];
  private reaper: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly authToken: string,
    private readonly maxConnections: number = DEFAULT_MAX_CONNECTIONS,
    private readonly pairingPort?: PairingPort,
  ) {}

  start(): void {
    this.reaper = setInterval(() => this.reapDeadConnections(), REAPER_INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.reaper);
    this.wss.close();
  }

  /** Se invoca desde el evento 'upgrade' del http.Server de apps/gateway. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const authHeader = request.headers["authorization"];
    const receivedToken = typeof authHeader === "string" ? authHeader : undefined;
    if (!safeCompareToken(receivedToken, `Bearer ${this.authToken}`)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (this.pending.size + this.byAgentId.size >= this.maxConnections) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.onSocketConnected(ws));
  }

  send(edgeAgentId: string, message: CoreToEdgeMessage): boolean {
    const conn = this.byAgentId.get(edgeAgentId);
    if (!conn || conn.socket.readyState !== WebSocket.OPEN) return false;
    conn.socket.send(JSON.stringify(message));
    return true;
  }

  onAgentConnected(handler: (info: AgentConnectionInfo) => void): Unsubscribe {
    this.connectedHandlers.push(handler);
    return () => removeHandler(this.connectedHandlers, handler);
  }

  onAgentDisconnected(handler: (edgeAgentId: string) => void): Unsubscribe {
    this.disconnectedHandlers.push(handler);
    return () => removeHandler(this.disconnectedHandlers, handler);
  }

  onMessage(handler: (edgeAgentId: string, message: EdgeToCoreMessage) => void): Unsubscribe {
    this.messageHandlers.push(handler);
    return () => removeHandler(this.messageHandlers, handler);
  }

  getState(edgeAgentId: string): "connected" | "disconnected" {
    const conn = this.byAgentId.get(edgeAgentId);
    return conn && conn.socket.readyState === WebSocket.OPEN ? "connected" : "disconnected";
  }

  private onSocketConnected(socket: WebSocket): void {
    const conn: TrackedConnection = { socket, lastSeen: Date.now() };
    this.pending.add(conn);
    conn.helloTimer = setTimeout(() => {
      if (this.pending.has(conn)) {
        socket.close(4000, "hello no recibido a tiempo");
        this.pending.delete(conn);
      }
    }, HELLO_TIMEOUT_MS);

    socket.on("message", (raw) => this.onSocketMessage(conn, raw));
    socket.on("close", () => this.onSocketClosed(conn));
  }

  private onSocketMessage(conn: TrackedConnection, raw: unknown): void {
    conn.lastSeen = Date.now();
    let message: EdgeToCoreMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return; // forma inesperada — se ignora sin tumbar la conexión (hallazgo M5 de docs/13)
    }

    if (message.type === "hello") {
      if (conn.edgeAgentId || conn.helloInFlight) {
        // Un socket ya autenticado (o con un hello ya en curso) no debería volver a mandar "hello" — protocolo violado (hallazgo A4).
        conn.socket.close(4003, "hello duplicado en la misma conexión");
        return;
      }
      conn.helloInFlight = true;
      void this.onHello(conn, message);
      return;
    }

    if (!conn.edgeAgentId) return;
    this.messageHandlers.forEach((handler) => handler(conn.edgeAgentId!, message));
  }

  private async onHello(conn: TrackedConnection, hello: HelloMessage): Promise<void> {
    if (majorVersion(hello.protocolVersion) !== majorVersion(PROTOCOL_VERSION)) {
      conn.socket.close(4001, "versión de protocolo incompatible");
      this.pending.delete(conn);
      return;
    }

    // Resuelve el ownerId antes de dar por conectado el agente (docs/19 P2,
    // incremento 3). Si el pairingToken no resuelve (revocado, corrupto, o
    // Supabase caído) la conexión NO se rechaza — sigue igual que hoy, sin
    // ownerId. Rechazar tumbaría un dispositivo físico por un problema de
    // identidad que todavía no bloquea nada (la autorización real es un
    // incremento posterior).
    let ownerId: string | undefined;
    if (hello.pairingToken && this.pairingPort) {
      try {
        ownerId = await this.pairingPort.resolveOwner(hello.pairingToken, hello.edgeAgentId);
      } catch {
        ownerId = undefined;
      }
    }

    // Si otro socket ya reclamaba este edgeAgentId (reconexión o colisión), se cierra
    // explícitamente en vez de dejarlo como conexión zombie (hallazgo A4 de docs/13).
    const existing = this.byAgentId.get(hello.edgeAgentId);
    if (existing && existing !== conn) {
      existing.socket.close(4004, "reemplazado por una nueva conexión del mismo Edge Agent");
    }

    clearTimeout(conn.helloTimer);
    this.pending.delete(conn);
    conn.edgeAgentId = hello.edgeAgentId;
    conn.ownerId = ownerId;
    this.byAgentId.set(hello.edgeAgentId, conn);

    const info: AgentConnectionInfo = {
      edgeAgentId: hello.edgeAgentId,
      protocolVersion: hello.protocolVersion,
      connectedAt: new Date().toISOString(),
      hello,
      ownerId,
    };
    this.connectedHandlers.forEach((handler) => handler(info));
  }

  private onSocketClosed(conn: TrackedConnection): void {
    this.pending.delete(conn);
    if (!conn.edgeAgentId) return;
    if (this.byAgentId.get(conn.edgeAgentId) === conn) {
      this.byAgentId.delete(conn.edgeAgentId);
      this.disconnectedHandlers.forEach((handler) => handler(conn.edgeAgentId!));
    }
  }

  private reapDeadConnections(): void {
    const now = Date.now();
    for (const [edgeAgentId, conn] of this.byAgentId) {
      if (now - conn.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        conn.socket.close(4002, "heartbeat perdido");
        this.byAgentId.delete(edgeAgentId);
        this.disconnectedHandlers.forEach((handler) => handler(edgeAgentId));
      }
    }
  }
}
