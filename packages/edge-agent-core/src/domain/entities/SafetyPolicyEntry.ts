import type { ActionSeverity } from "@kan/plugin-contract";

/**
 * Override explícito de severidad para un target de un dispositivo (ej. un
 * pin GPIO), creado únicamente por una acción deliberada del usuario en la
 * app de escritorio — nunca inferido por el software (regla 3 del sistema
 * de Safety Policy, docs/00).
 */
export interface SafetyPolicyEntry {
  deviceId: string;
  target: string;
  alias?: string;
  severity: ActionSeverity;
  updatedAt: string;
}
