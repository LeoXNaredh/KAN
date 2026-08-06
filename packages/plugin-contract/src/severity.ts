/**
 * Clasificación de severidad de una acción (ADR-004, docs/00).
 * Determina si el Permission Manager la ejecuta directo o exige confirmación
 * explícita antes de tocar el dispositivo real.
 */
export type ActionSeverity =
  | "read-only"
  | "reversible"
  | "irreversible-material"
  | "safety-critical";

export function requiresConfirmation(severity: ActionSeverity): boolean {
  return severity === "irreversible-material" || severity === "safety-critical";
}
