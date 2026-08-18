import type { AlertRule } from "../domain/entities/AlertRule";

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function capitalizeFirst(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Mensaje en lenguaje simple de una alerta disparada (requisito: "La
 * temperatura llegó a 43 grados, superó el límite que definiste de 40.") —
 * nunca el nombre técnico de la capability ni el JSON crudo del resultado,
 * mismo criterio que describeConfirmationConsequence (@kan/plugin-contract).
 * `rule.label` ya viene con artículo en español (ej. "la temperatura",
 * pedido así en ALERT_TOOL_DESCRIPTORS) — acá solo se capitaliza para que
 * abra la oración.
 */
export function describeAlertTriggered(rule: AlertRule, value: number): string {
  const unit = rule.unit ? ` ${rule.unit}` : "";
  const verbPhrase = rule.comparator === "above" ? "superó el límite" : "bajó del límite";
  // La unidad va una sola vez, junto al valor medido — repetirla junto al
  // umbral ("...de 40 grados.") no es lo que pide el requisito ("...de 40.").
  return `${capitalizeFirst(rule.label)} llegó a ${formatNumber(value)}${unit}, ${verbPhrase} que definiste de ${formatNumber(rule.threshold)}.`;
}
