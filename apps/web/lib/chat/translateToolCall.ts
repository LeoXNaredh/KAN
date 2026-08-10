/**
 * Traduce el nombre técnico de una tool (ej. `read_sensor`, `kan_set_memory`,
 * `kan_schedule_job`) a una frase humana genérica pero descriptiva — mismo
 * principio que `translateAuditEntry.ts` (docs/17 §3.1: el cliente nunca ve
 * un identificador de función cruda). Por patrón de palabras clave, no por
 * nombre exacto: los plugins de hardware agregan capabilities nuevas todo el
 * tiempo (hoy hay ~45 entre los 15 plugins), y una tabla de nombres exactos
 * quedaría desactualizada de inmediato. Orden de los patrones = prioridad —
 * el primero que matchea gana. Cada categoría trae su frase "en curso" (tool
 * call) y su frase "lista" (tool result) por separado — no se derivan una de
 * la otra por regex, para no arriesgar una conjugación mal formada.
 */
const CATEGORIES: Array<{ test: RegExp; inProgress: string; done: string }> = [
  { test: /memor/i, inProgress: "Guardando en memoria…", done: "Guardado en memoria." },
  { test: /schedule|cancel_job|list_jobs|_job\b/i, inProgress: "Programando tarea…", done: "Tarea programada." },
  {
    test: /active_device|active_project|current_task|context/i,
    inProgress: "Actualizando el contexto…",
    done: "Contexto actualizado.",
  },
  { test: /search|research|investigat/i, inProgress: "Investigando…", done: "Investigación lista." },
  { test: /connect/i, inProgress: "Conectando con tu dispositivo…", done: "Conectado." },
  {
    test: /^(read|get|list|scan|discover|browse|home_axes)/i,
    inProgress: "Consultando tu dispositivo…",
    done: "Consulta lista.",
  },
  {
    test: /^(write|set|toggle|send|publish|execute|print|move|pause|resume|wake|start|stop|emergency|cancel|call_ha|subscribe|unsubscribe)/i,
    inProgress: "Actuando sobre tu dispositivo…",
    done: "Listo.",
  },
];

const FALLBACK = { inProgress: "Trabajando en eso…", done: "Listo." };

function categoryFor(toolName: string) {
  return CATEGORIES.find(({ test }) => test.test(toolName)) ?? FALLBACK;
}

/** Frase para mientras la tool está corriendo (evento `tool_call`, streaming). */
export function translateToolCall(toolName: string): string {
  return categoryFor(toolName).inProgress;
}

/** Frase para el resultado ya terminado (evento `tool_result`) — nunca JSON crudo ni el nombre técnico en el error. */
export function translateToolResult(toolName: string, success: boolean, error?: string): string {
  if (success) return categoryFor(toolName).done;
  return `No se pudo completar: ${error ?? "error desconocido"}`;
}
