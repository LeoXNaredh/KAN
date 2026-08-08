import type { ActionSeverity } from "./severity";
import type { CapabilityDescriptor } from "./capability";
import type { PluginManifest } from "./manifest";

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
  os?: string;
  agentVersion?: string;
  installedPlugins: PluginManifest[];
  capabilities: Array<{ deviceId: string; deviceName: string; capability: CapabilityDescriptor }>;
  /**
   * Secreto de pairing (docs/19 P2, incremento 3) — presente solo si este
   * Edge Agent ya fue vinculado a un usuario. El Gateway lo resuelve a un
   * `ownerId` en `onHello()`; ausente, la conexión sigue funcionando igual
   * que antes (retrocompatible, sin `ownerId`).
   */
  pairingToken?: string;
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
  status: "progress" | "done" | "failed" | "pending_confirmation";
  data?: unknown;
  error?: string;
  confirmationId?: string;
  at: string;
}

/**
 * Notifica al Gateway que el usuario cambió la Safety Policy local de un
 * target (ej. reclasificó un pin) para que quede en la auditoría (docs/00,
 * regla 7 del sistema de Safety Policy) — el cambio en sí ya ocurrió y se
 * persistió localmente en el Edge Agent; esto es solo el registro.
 */
export interface SafetyPolicyChangedMessage {
  type: "safety_policy.changed";
  deviceId: string;
  target: string;
  alias?: string;
  severity: ActionSeverity;
  previousSeverity?: ActionSeverity;
  at: string;
}

/**
 * Deja constancia en la auditoría del Gateway de una invocación disparada
 * localmente en el Edge Agent (ej. los botones "Invocar" de apps/desktop),
 * que de otro modo nunca pasa por ToolExecutor/AuditService del lado del
 * Gateway (docs/16 P4, ADR-025). Enviado además de — nunca en vez de — la
 * telemetría normal cuando la invocación vino de un AgentTaskDispatchMessage.
 */
export interface AuditLocalMessage {
  type: "audit.local";
  deviceId: string;
  capability: string;
  success: boolean;
  error?: string;
  at: string;
}

export type CoreToEdgeMessage = AgentTaskDispatchMessage;
export type EdgeToCoreMessage =
  | HelloMessage
  | HeartbeatMessage
  | TelemetryMessage
  | SafetyPolicyChangedMessage
  | AuditLocalMessage;
