import type { TaskRequest } from "./GatewayTask";

export type AlertComparator = "above" | "below";

/**
 * Alerta de umbral sobre un sensor (requisito: "avisame si la temperatura
 * supera 40 grados") — vigila el valor que devuelve una capability de
 * lectura ya disponible, sondeada periódicamente por `AlertMonitor`. No es
 * un `ScheduledJob`: no ejecuta ninguna acción por sí sola — con `steps`
 * (multi-dispositivo coordinado), al disparar corre esa secuencia con el
 * mismo runner que `kan_run_sequence` (ver `Gateway.runSteps()`), respetando
 * el mismo flujo de confirmación para pasos irreversible-material/safety-critical.
 */
export interface AlertRule {
  id: string;
  /** El nombre exacto de una tool/capability ya disponible (misma convención que ScheduledJob.steps[].capabilityRef). */
  capabilityRef: string;
  /** Ruta (con puntos) dentro de `CapabilityResult.data` hacia el valor numérico a comparar — ej. "temperatureC". Sin ella, se usa `data` tal cual si ya es un número. */
  field?: string;
  comparator: AlertComparator;
  threshold: number;
  /** Frase natural en español (con artículo, ej. "la temperatura") — se usa tal cual al armar el mensaje del aviso. */
  label: string;
  /** Unidad en lenguaje simple (ej. "grados") — opcional. */
  unit?: string;
  createdAt: string;
  /** Usuario que la creó (P7, mismo criterio que ScheduledJob.createdBy) — a quién avisarle por push/voz cuando dispare. */
  createdBy?: string;
  /** Multi-dispositivo coordinado (opcional): secuencia a ejecutar cuando la alerta se dispara, mismo formato que kan_run_sequence/ScheduledJob.steps. */
  steps?: TaskRequest[];
}
