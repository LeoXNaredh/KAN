import type { ActionSeverity } from "./severity";

/**
 * Texto humano para el modal de confirmación de una acción física — mismo
 * criterio que `translateToolCall` (packages/core): nunca el nombre técnico
 * de la capability, el severity enum crudo, ni el JSON de sus argumentos.
 * Compartido entre `apps/web` (`PendingConfirmationModal`) y `apps/desktop`
 * (`ConfirmationModal`), las dos únicas superficies que muestran esta
 * confirmación — ambas ya dependen de este paquete.
 *
 * El detalle específico de QUÉ va a hacer KAN ya lo dio el asistente en el
 * mensaje de chat inmediatamente anterior (SYSTEM_PROMPT/VOICE_SYSTEM_PROMPT
 * ya piden explicarlo en una frase simple antes de pedir confirmación) — este
 * texto solo transmite la consecuencia de confirmar, no repite el detalle.
 */
export function describeConfirmationConsequence(severity: ActionSeverity): string {
  if (severity === "safety-critical") {
    return "Esto puede afectar la seguridad del sistema — fijate bien antes de confirmar.";
  }
  return "Esto cambia algo físico real y no se puede deshacer después.";
}
