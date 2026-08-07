import type { TaskRequest } from "./GatewayTask";

/**
 * Job programado real (P6, ADR-019) — exactamente uno de `cron`/`runAt` debe
 * estar presente, validado por el `SchedulerPort` concreto en `schedule()`.
 */
export interface ScheduledJob {
  id: string;
  taskRequest: TaskRequest;
  /** Sintaxis de node-cron (incluye segundos opcionales como primer campo). */
  cron?: string;
  /** ISO 8601 — ejecución única, debe ser una fecha futura al crear el job. */
  runAt?: string;
}
