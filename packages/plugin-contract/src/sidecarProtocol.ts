import type { CapabilityDescriptor, CapabilityResult } from "./capability";
import type { DeviceDescriptor } from "./deviceDriverPort";
import type { TargetDescriptor } from "./targetDescriptor";

/**
 * Protocolo Edge Agent <-> Plugin sidecar (ADR-056, docs/07-arquitectura-comunicacion.md §1).
 * Independiente de `PROTOCOL_VERSION` (protocol.ts, Core<->Edge) — versiona
 * el contrato entre el Edge Agent y un proceso hijo `python-sidecar`, no la
 * conexión con el Gateway.
 *
 * Transporte: WebSocket loopback (`ws`), Edge Agent como servidor,
 * el sidecar como cliente (inverso de `WsConnectionManager`/
 * `CoreWebSocketClient` a propósito: el Edge Agent abre el puerto en
 * `127.0.0.1` *antes* de spawnear el proceso hijo y le pasa el puerto real
 * por variable de entorno, sin tener que adivinar/pollear un puerto
 * elegido por Python). Nunca expuesto fuera de loopback.
 */
export const SIDECAR_PROTOCOL_VERSION = "1.0.0";

/** Primer mensaje obligatorio, sidecar -> Edge Agent, autentica el handshake. */
export interface SidecarHelloMessage {
  type: "sidecar_hello";
  protocolVersion: string;
  pluginId: string;
  pluginVersion: string;
  /** Token de un solo uso pasado al proceso hijo por `KAN_SIDECAR_TOKEN` (nunca por argv). */
  token: string;
}

/** Edge Agent -> sidecar. Si el handshake no es válido, el socket se cierra en vez de mandar este mensaje. */
export interface SidecarHelloAckMessage {
  type: "sidecar_hello_ack";
  ok: true;
}

export interface DiscoverRequestMessage {
  type: "discover";
  requestId: string;
}

export interface DiscoverResultMessage {
  type: "discover.result";
  requestId: string;
  devices: DeviceDescriptor[];
}

export interface ConnectRequestMessage {
  type: "connect";
  requestId: string;
  deviceId: string;
}

/**
 * `capabilities` viaja en la misma respuesta que `connect` (no en un
 * mensaje separado) porque `DeviceManager.discoverAndConnect()` llama
 * `getCapabilities()` de forma síncrona inmediatamente después de
 * `await connect()` (`packages/edge-agent-core/src/application/DeviceManager.ts`).
 * `SidecarProxyPlugin` cachea este array para responder `getCapabilities()`
 * sin una vuelta más de red.
 */
export interface ConnectResultMessage {
  type: "connect.result";
  requestId: string;
  ok: boolean;
  capabilities?: CapabilityDescriptor[];
  error?: string;
}

export interface DisconnectRequestMessage {
  type: "disconnect";
  requestId: string;
  deviceId: string;
}

export interface DisconnectResultMessage {
  type: "disconnect.result";
  requestId: string;
  ok: boolean;
}

export interface InvokeRequestMessage {
  type: "invoke";
  requestId: string;
  deviceId: string;
  capability: string;
  input: unknown;
}

export interface InvokeResultMessage {
  type: "invoke.result";
  requestId: string;
  result: CapabilityResult;
}

export interface ListTargetsRequestMessage {
  type: "list_targets";
  requestId: string;
  deviceId: string;
}

export interface ListTargetsResultMessage {
  type: "list_targets.result";
  requestId: string;
  targets: TargetDescriptor[];
}

/** Sidecar -> Edge Agent, periódico. Timeout más corto que el heartbeat Core<->Edge por ser loopback. */
export interface SidecarHeartbeatMessage {
  type: "heartbeat";
  at: string;
}

/** Edge Agent -> sidecar. Apagado ordenado antes de SIGTERM/SIGKILL (ver `SidecarProxyPlugin.onUnload()`). */
export interface SidecarShutdownMessage {
  type: "shutdown";
}

/** Subconjunto de `EdgeToSidecarMessage` que siempre lleva `requestId` — lo que `SidecarWsHost.request()` puede construir y correlacionar. */
export type SidecarRequestMessage =
  | DiscoverRequestMessage
  | ConnectRequestMessage
  | DisconnectRequestMessage
  | InvokeRequestMessage
  | ListTargetsRequestMessage;

/**
 * `Omit<SidecarRequestMessage, "requestId">` NO distribuye sobre la unión
 * (`keyof` de una unión intersecta las claves, así que `Omit` la colapsa a
 * solo `type`) — este helper sí distribuye, aplicando `Omit` a cada
 * miembro por separado antes de volver a unir. Es lo que le permite a
 * `SidecarWsHost.request()` aceptar `{ type: "connect", deviceId }` sin
 * perder `deviceId`/`capability`/`input` del tipado.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Lo que un caller le pasa a `SidecarWsHost.request()` — mismo shape que `SidecarRequestMessage` sin `requestId` (lo genera el host). */
export type SidecarRequestInput = DistributiveOmit<SidecarRequestMessage, "requestId">;

export type SidecarToEdgeMessage =
  | SidecarHelloMessage
  | DiscoverResultMessage
  | ConnectResultMessage
  | DisconnectResultMessage
  | InvokeResultMessage
  | ListTargetsResultMessage
  | SidecarHeartbeatMessage;

export type EdgeToSidecarMessage =
  | SidecarHelloAckMessage
  | DiscoverRequestMessage
  | ConnectRequestMessage
  | DisconnectRequestMessage
  | InvokeRequestMessage
  | ListTargetsRequestMessage
  | SidecarShutdownMessage;
