import type { ActionSeverity } from "./severity";
import type { CapabilityDescriptor } from "./capability";

/**
 * Protocolo Core Cloud <-> Edge Agent (docs/07-arquitectura-comunicacion.md).
 * Definido ahora del lado del Edge Agent aunque el servidor del Core que lo
 * consume (Core Gateway, ADR-009) es un incremento posterior.
 */
export const PROTOCOL_VERSION = "1.0.0";

export interface HelloMessage {
  type: "hello";
  protocolVersion: string;
  edgeAgentId: string;
  capabilities: Array<{ deviceId: string; capability: CapabilityDescriptor }>;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  at: string;
}

export interface AgentTaskDispatchMessage {
  type: "agent_task.dispatch";
  taskId: string;
  deviceId: string;
  capability: string;
  severity: ActionSeverity;
  requiresConfirmation: boolean;
  payload: unknown;
  issuedAt: string;
}

export interface TelemetryMessage {
  type: "telemetry";
  taskId: string;
  status: "progress" | "done" | "failed";
  data?: unknown;
  error?: string;
  at: string;
}

export type CoreToEdgeMessage = AgentTaskDispatchMessage;
export type EdgeToCoreMessage = HelloMessage | HeartbeatMessage | TelemetryMessage;
