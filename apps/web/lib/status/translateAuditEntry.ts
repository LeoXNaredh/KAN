export interface RawAuditEntry {
  id: string;
  at: string;
  actor: "llm" | "user" | "system";
  action: string;
  subject: string;
  metadata: Record<string, unknown>;
}

/** Mismo texto que ya muestra /logs junto a cada entrada — única fuente para pantalla y exportación CSV. */
export const ACTOR_LABEL: Record<string, string> = { llm: "KAN", user: "Vos", system: "Sistema" };

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
    case "alert.triggered":
      return typeof entry.metadata.body === "string" ? entry.metadata.body : "Se disparó una alerta";
    case "device.enriched":
      return `Investigué tu dispositivo "${entry.subject}"`;
    case "job.cancel.denied":
      return `Se rechazó un intento de cancelar un recordatorio ajeno`;
    default:
      // Nunca el `action` interno crudo (ej. "device.enriched") — mismo
      // criterio de tono que el resto del archivo, para una acción futura
      // sin traducir todavía.
      return `Hubo actividad reciente: "${entry.subject}"`;
  }
}

/**
 * Dispositivo/capability involucrado, para la columna "Dispositivo" del CSV
 * exportado desde /logs. `subject` no siempre es un nombre lindo de
 * dispositivo (para tool.execute/tool.execute.denied/job.fired es el
 * capabilityRef técnico, ej. "c_ab12cd34_device1_setBrightness") — es la
 * mejor aproximación disponible sin cruzar con la lista de capabilities en
 * vivo, que /logs no carga hoy. Vacío cuando la entrada no involucra ningún
 * dispositivo (ej. job.notification, alert.triggered).
 */
export function deviceFromAuditEntry(entry: RawAuditEntry): string {
  switch (entry.action) {
    case "device.enriched":
    case "tool.execute":
    case "tool.execute.denied":
    case "job.fired":
      return entry.subject;
    case "safety_policy.changed":
    case "audit.local": {
      // subject = `${edgeAgentId}/${deviceId}/${target|capability}`.
      const parts = entry.subject.split("/");
      return parts.length >= 2 ? parts[1] : entry.subject;
    }
    default:
      return "";
  }
}

/**
 * Resultado (exitoso/fallido), para la columna "Resultado" del CSV. OJO:
 * `tool.execute` se audita ANTES de ejecutar (ver ToolExecutor.execute en
 * packages/gateway-core) — no existe hoy un segundo registro de auditoría
 * con el resultado real de esa ejecución, así que para esa acción (la más
 * frecuente) no hay dato confiable y se devuelve "—" en vez de inventarlo.
 */
export function resultFromAuditEntry(entry: RawAuditEntry): "Exitoso" | "Fallido" | "—" {
  switch (entry.action) {
    case "tool.execute.denied":
      return "Fallido";
    case "audit.local":
      return entry.metadata.success === false ? "Fallido" : "Exitoso";
    case "job.notification":
      return entry.metadata.failed === true ? "Fallido" : "Exitoso";
    case "device.enriched":
    case "safety_policy.changed":
    case "job.fired":
    case "alert.triggered":
      return "Exitoso";
    default:
      return "—";
  }
}
