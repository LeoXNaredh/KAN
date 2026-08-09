export interface RawAuditEntry {
  id: string;
  at: string;
  actor: "llm" | "user" | "system";
  action: string;
  subject: string;
  metadata: Record<string, unknown>;
}

/**
 * Traduce una entrada cruda del Audit Service (docs/12 §9) a texto legible —
 * misma regla del BFF: el cliente nunca ve `action` crudo. Compartida entre
 * app/api/status/route.ts (actividad reciente del Dashboard) y /logs (P1.3,
 * historial completo). Solo traduce las acciones que el Gateway realmente
 * emite hoy; cualquier acción futura cae al genérico en vez de romper la UI.
 */
export function translateAuditEntry(entry: RawAuditEntry): string {
  switch (entry.action) {
    case "tool.execute":
      return `Se ejecutó "${entry.subject}"`;
    case "safety_policy.changed":
      return `Cambió la política de seguridad de ${entry.subject}`;
    case "job.fired":
      return `Se disparó el job programado "${entry.subject}"`;
    case "job.notification":
      return `Notificación de automatización: "${entry.subject}"`;
    case "device.enriched":
      return `Investigué tu dispositivo "${entry.subject}"`;
    default:
      return `${entry.action}: ${entry.subject}`;
  }
}
