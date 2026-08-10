/**
 * Traduce el nombre técnico de una tool (ej. `read_sensor`, `kan_set_memory`,
 * `kan_schedule_job`) a una frase humana genérica pero descriptiva — nunca
 * el nombre de función crudo ni el JSON de su resultado (VISION_PRODUCT_v0.2.md
 * §3.1/§4.4). Compartida entre `SendMessageUseCase` (el `content` persistido
 * de un mensaje "tool" — solo para mostrar; lo que realmente vuelve al LLM
 * es `Message.toolResult`, sin tocar, ver `GeminiProvider`/etc.) y
 * `apps/web` (el mismo texto mientras la tool corre, antes de que llegue el
 * mensaje final persistido). Por patrón de palabras clave, no por nombre
 * exacto: los plugins de hardware agregan capabilities nuevas todo el
 * tiempo, y una tabla de nombres exactos quedaría desactualizada de
 * inmediato. Orden de los patrones = prioridad — el primero que matchea gana.
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

/** Frase para el resultado ya terminado — nunca JSON crudo ni el nombre técnico en el error. */
export function translateToolResult(toolName: string, success: boolean, error?: string): string {
  if (success) return categoryFor(toolName).done;
  return `No se pudo completar: ${error ?? "error desconocido"}`;
}
