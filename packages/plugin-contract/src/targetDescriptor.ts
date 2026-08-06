import type { ActionSeverity } from "./severity";

/**
 * Un target físico direccionable dentro de un dispositivo (ej. un pin GPIO).
 * Lo devuelve `KanDeviceDriverPlugin.listTargets()` para que la Safety
 * Policy del dispositivo (SafetyPolicyStore, @kan/edge-agent-core) tenga
 * algo que ofrecer al usuario para clasificar, incluso antes de que
 * cualquier capability lo haya usado.
 */
export interface TargetDescriptor {
  target: string;
  suggestedAlias?: string;
  defaultSeverity: ActionSeverity;
}
