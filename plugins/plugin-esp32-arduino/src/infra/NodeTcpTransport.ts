import { Socket } from "node:net";
import type { LineConnection, LineConnectionState } from "@kan/serial-line-transport";
import type { NetworkTransportPort, TransportOptions } from "../NetworkTransportPort";

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_BASE_RECONNECT_DELAY_MS = 500;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export interface NodeTcpTransportTuning {
  /** Máximo de reintentos ante una caída (default 5, ver PROTOCOL.md). */
  maxReconnectAttempts?: number;
  /** Base del backoff exponencial en ms (default 500 — 500ms, 1s, 2s, 4s, 8s). */
  baseReconnectDelayMs?: number;
  connectTimeoutMs?: number;
}

/**
 * Conexión TCP con reconexión automática (backoff exponencial, hasta
 * MAX_RECONNECT_ATTEMPTS) ante una caída de WiFi transitoria — a diferencia
 * de un puerto serial, una IP:puerto sigue siendo válida después de que la
 * conexión se cae, tiene sentido reintentar antes de darse por vencido.
 *
 * Maneja explícitamente error/close/end/timeout del socket: el error
 * durante la conexión inicial rechaza open(); cualquier error posterior
 * nunca deja una promesa sin resolver — se resuelve solo vía el ciclo de
 * reconexión que dispara "close".
 */
class TcpLineConnection implements LineConnection {
  private socket: Socket | undefined;
  private buffer = "";
  private _state: LineConnectionState = "connected";
  private readonly lineHandlers: Array<(line: string) => void> = [];
  private readonly stateHandlers: Array<(state: LineConnectionState) => void> = [];
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly maxReconnectAttempts: number;
  private readonly baseReconnectDelayMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly host: string,
    private readonly port: number,
    /** Reservado — ver TODO de seguridad en openSocket(). */
    private readonly options: TransportOptions | undefined,
    tuning: NodeTcpTransportTuning = {},
  ) {
    this.maxReconnectAttempts = tuning.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.baseReconnectDelayMs = tuning.baseReconnectDelayMs ?? DEFAULT_BASE_RECONNECT_DELAY_MS;
    this.connectTimeoutMs = tuning.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  get state(): LineConnectionState {
    return this._state;
  }

  connectInitial(): Promise<void> {
    return this.openSocket();
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;
      let settled = false;

      socket.setTimeout(this.connectTimeoutMs);

      socket.once("connect", () => {
        settled = true;
        this.reconnectAttempt = 0;
        this.setState("connected");

        // TODO(seguridad): antes de aceptar comandos, validar options.token
        // con un handshake contra el firmware. Hoy cualquiera en la red
        // local que sepa IP:puerto puede conectarse y mandar comandos a una
        // máquina física real (ej. mover un láser) — bloqueante para
        // cualquier red que no sea de confianza total.
        // Ver PROTOCOL.md "Seguridad (pendiente)".

        resolve();
      });

      socket.on("data", (chunk: Buffer) => this.handleData(chunk));

      socket.on("error", () => {
        // No relanzar: "close" siempre se dispara justo después de "error"
        // en node:net y es ahí donde se decide qué hacer (rechazar el
        // intento inicial o programar una reconexión). Sin este listener,
        // un error dejaría el proceso entero si nadie más lo escucha.
        if (!settled) {
          settled = true;
          reject(new Error(`No se pudo conectar a ${this.host}:${this.port}`));
        }
      });

      socket.once("timeout", () => {
        socket.destroy();
      });

      socket.once("end", () => {
        // El otro lado cerró de forma prolija (FIN) — "close" decide el resto.
      });

      socket.once("close", () => {
        if (this.manuallyClosed) {
          this.setState("disconnected");
          return;
        }
        if (!settled) {
          // Se cerró antes de conectar y sin "error" explícito (raro, pero posible).
          settled = true;
          reject(new Error(`Conexión cerrada antes de establecerse: ${this.host}:${this.port}`));
        }
        this.scheduleReconnect();
      });

      socket.connect(this.port, this.host);
    });
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      return;
    }
    this.setState("reconnecting");
    const delay = this.baseReconnectDelayMs * 2 ** this.reconnectAttempt;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.openSocket().catch(() => {
        // openSocket() ya programó el próximo reintento (o marcó "disconnected"
        // si se agotaron) desde su propio handler de "close" — nada más que hacer.
      });
    }, delay);
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.lineHandlers.forEach((handler) => handler(line));
      index = this.buffer.indexOf("\n");
    }
  }

  private setState(state: LineConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }

  write(line: string): void {
    if (this._state !== "connected" || !this.socket) {
      throw new Error(`No se puede escribir: conexión "${this._state}" (${this.host}:${this.port})`);
    }
    this.socket.write(`${line}\n`);
  }

  onLine(handler: (line: string) => void): () => void {
    this.lineHandlers.push(handler);
    return () => {
      const index = this.lineHandlers.indexOf(handler);
      if (index !== -1) this.lineHandlers.splice(index, 1);
    };
  }

  onStateChange(handler: (state: LineConnectionState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      const index = this.stateHandlers.indexOf(handler);
      if (index !== -1) this.stateHandlers.splice(index, 1);
    };
  }

  close(): Promise<void> {
    this.manuallyClosed = true;
    clearTimeout(this.reconnectTimer);
    // Explícito ya mismo: no depender del timing del evento "close" del
    // socket (el callback de socket.end() dispara antes de que "close" se
    // dispare de verdad — un write() inmediatamente después de close() no
    // debe poder colarse creyendo que la conexión sigue viva).
    this.setState("disconnected");
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.end(() => resolve());
    });
  }
}

export class NodeTcpTransport implements NetworkTransportPort {
  constructor(private readonly tuning: NodeTcpTransportTuning = {}) {}

  async open(host: string, port: number, options?: TransportOptions): Promise<LineConnection> {
    const connection = new TcpLineConnection(host, port, options, this.tuning);
    await connection.connectInitial();
    return connection;
  }
}
