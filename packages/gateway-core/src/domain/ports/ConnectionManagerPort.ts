import type { CoreToEdgeMessage, EdgeToCoreMessage, HelloMessage } from "@kan/plugin-contract";

export interface AgentConnectionInfo {
  edgeAgentId: string;
  protocolVersion: string;
  connectedAt: string;
  hello: HelloMessage;
}

export type Unsubscribe = () => void;

/**
 * El único módulo que toca el transporte WebSocket real (docs/12 §1).
 * "hello" se resuelve internamente (es lo que revela el edgeAgentId de una
 * conexión nueva) y se expone vía onAgentConnected con el payload completo;
 * el resto de mensajes de un agente ya conocido se bubblean por onMessage.
 *
 * Cada `on*` devuelve una función para des-suscribirse (mismo patrón que el
 * preload de apps/desktop) — necesario para que los tests puedan recrear
 * composition roots sin acumular handlers fantasma (hallazgo A10 de docs/13).
 */
export interface ConnectionManagerPort {
  start(): void;
  stop(): void;
  send(edgeAgentId: string, message: CoreToEdgeMessage): boolean;
  onAgentConnected(handler: (info: AgentConnectionInfo) => void): Unsubscribe;
  onAgentDisconnected(handler: (edgeAgentId: string) => void): Unsubscribe;
  onMessage(handler: (edgeAgentId: string, message: EdgeToCoreMessage) => void): Unsubscribe;
  getState(edgeAgentId: string): "connected" | "disconnected";
}
