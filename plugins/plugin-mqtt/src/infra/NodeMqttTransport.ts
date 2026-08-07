import mqtt, { type MqttClient } from "mqtt";
import type {
  MqttConnection,
  MqttConnectionState,
  MqttConnectionStateInfo,
  MqttConnectOptions,
  MqttPublishOptions,
  MqttTransportPort,
} from "../MqttTransportPort";
import { matchesTopicFilter } from "./topicMatch";

const DEFAULT_RECONNECT_PERIOD_MS = 2000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export interface NodeMqttTransportTuning {
  /** Periodo fijo entre reintentos de mqtt.js — no es backoff exponencial (ver ADR-022). Default 2000ms. */
  reconnectPeriodMs?: number;
  /** `undefined` (default) = reintentos infinitos. Un broker es infraestructura estable, no hardware que puede desaparecer para siempre — a diferencia de NodeTcpTransport, no hay tope por defecto. */
  maxReconnectAttempts?: number;
  connectTimeoutMs?: number;
}

interface Subscription {
  filter: string;
  handler: (payload: string, topic: string) => void;
}

/**
 * Conexión MQTT real sobre el paquete `mqtt` (mqtt.js) — se apoya en su
 * reconexión nativa (mismo cliente persiste, re-suscribe automáticamente
 * los topics ya registrados vía `resubscribe: true`, el default) en vez de
 * reimplementar backoff exponencial a mano como NodeTcpTransport: hacerlo
 * significaría recrear el cliente en cada intento y perder ese resubscribe
 * gratis (ver ADR-022). `maxReconnectAttempts` es opt-in (default sin
 * tope) — si se agota, se fuerza un `end()` y el estado pasa a
 * "disconnected" de forma terminal, igual que TCP.
 *
 * mqtt.js expone un único evento `message` por conexión (no uno por
 * suscripción) — `subscriptions` despacha cada mensaje entrante al/los
 * handler(s) cuyo filtro matchea, vía matchesTopicFilter (soporta `+`/`#`).
 */
class MqttClientConnection implements MqttConnection {
  private _state: MqttConnectionState = "connected";
  private reconnectAttempt = 0;
  private unreachableSince: string | undefined;
  private manuallyClosed = false;
  private readonly stateHandlers: Array<(info: MqttConnectionStateInfo) => void> = [];
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly client: MqttClient,
    private readonly maxReconnectAttempts: number | undefined,
  ) {
    client.on("connect", () => {
      this.reconnectAttempt = 0;
      this.unreachableSince = undefined;
      this.setState("connected");
    });

    client.on("reconnect", () => {
      if (this.manuallyClosed) return;
      this.reconnectAttempt += 1;
      if (this.unreachableSince === undefined) this.unreachableSince = new Date().toISOString();

      if (this.maxReconnectAttempts !== undefined && this.reconnectAttempt > this.maxReconnectAttempts) {
        this.manuallyClosed = true; // evita que el "close" disparado por este end() reintente de nuevo.
        this.client.end(true);
        this.setState("disconnected");
        return;
      }
      this.setState("reconnecting");
    });

    // "close" solo importa acá cuando fue manual (o cuando agotamos los
    // reintentos arriba, que ya se encarga de sí mismo) — si mqtt.js lo
    // disparó por una caída transitoria, el propio "reconnect" ya está en
    // marcha (o se disparará), no hay nada más que hacer.
    client.on("close", () => {
      if (this.manuallyClosed) this.setState("disconnected");
    });

    // Nunca dejar "error" sin manejar (tumbaría el proceso) — mqtt.js ya
    // reintenta solo vía su ciclo interno; loguear alcanza.
    client.on("error", (error) => {
      console.error("[NodeMqttTransport] error de conexión:", error.message);
    });

    client.on("message", (topic, payloadBuffer) => {
      const payload = payloadBuffer.toString("utf8");
      for (const subscription of this.subscriptions) {
        if (matchesTopicFilter(subscription.filter, topic)) subscription.handler(payload, topic);
      }
    });
  }

  get state(): MqttConnectionState {
    return this._state;
  }

  private setState(state: MqttConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    const info: MqttConnectionStateInfo = {
      state,
      reconnectAttempt: state === "connected" ? 0 : this.reconnectAttempt,
      unreachableSince: this.unreachableSince,
    };
    this.stateHandlers.forEach((handler) => handler(info));
  }

  async publish(topic: string, payload: string, options?: MqttPublishOptions): Promise<void> {
    if (this._state !== "connected") {
      throw new Error(`No se puede publicar: conexión MQTT "${this._state}"`);
    }
    await this.client.publishAsync(topic, payload, { qos: options?.qos ?? 0, retain: options?.retain ?? false });
  }

  async subscribe(topic: string, handler: (payload: string, topic: string) => void): Promise<void> {
    if (this._state !== "connected") {
      throw new Error(`No se puede suscribir: conexión MQTT "${this._state}"`);
    }
    await this.client.subscribeAsync(topic);
    this.subscriptions.push({ filter: topic, handler });
  }

  async unsubscribe(topic: string): Promise<void> {
    const index = this.subscriptions.findIndex((subscription) => subscription.filter === topic);
    if (index === -1) return; // idempotente — nada que hacer.
    this.subscriptions.splice(index, 1);
    if (this._state === "connected") await this.client.unsubscribeAsync(topic);
  }

  onStateChange(handler: (info: MqttConnectionStateInfo) => void): () => void {
    this.stateHandlers.push(handler);
    return () => {
      const index = this.stateHandlers.indexOf(handler);
      if (index !== -1) this.stateHandlers.splice(index, 1);
    };
  }

  async close(): Promise<void> {
    this.manuallyClosed = true;
    // Explícito ya mismo, no depender del timing del evento "close" —
    // mismo criterio que TcpLineConnection.close() en NodeTcpTransport.
    this.setState("disconnected");
    await this.client.endAsync();
  }
}

export class NodeMqttTransport implements MqttTransportPort {
  constructor(private readonly tuning: NodeMqttTransportTuning = {}) {}

  connect(brokerUrl: string, options?: MqttConnectOptions): Promise<MqttConnection> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(brokerUrl, {
        reconnectPeriod: this.tuning.reconnectPeriodMs ?? DEFAULT_RECONNECT_PERIOD_MS,
        connectTimeout: options?.connectTimeoutMs ?? this.tuning.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        resubscribe: true,
      });

      let settled = false;

      // Permanente desde el arranque, no `.once`: mqtt.js puede emitir
      // "error" más de una vez durante el intento inicial (cada intento
      // fallido antes de que nosotros decidamos rendirnos), y un
      // EventEmitter sin listener de "error" tumba el proceso entero —
      // mismo cuidado que TcpLineConnection.openSocket(). Una vez resuelto,
      // este listener queda como no-op permanente; MqttClientConnection
      // agrega el suyo propio (con logging real) desde ese momento.
      client.on("error", (error) => {
        if (settled) return;
        settled = true;
        client.end(true);
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      client.once("connect", () => {
        if (settled) return;
        settled = true;
        resolve(new MqttClientConnection(client, this.tuning.maxReconnectAttempts));
      });
    });
  }
}
