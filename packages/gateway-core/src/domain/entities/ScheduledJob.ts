import type { TaskRequest } from "./GatewayTask";

/** Notificación disparada al terminar los `steps` de un job (P6 Fase 2, ADR-021). */
export interface JobNotification {
  title: string;
  body: string;
}

/**
 * Job programado real (P6, ADR-019/ADR-021) — exactamente uno de
 * `cron`/`runAt` debe estar presente, validado por el `SchedulerPort`
 * concreto en `schedule()`. `steps` es una secuencia de capabilities
 * ejecutadas en orden ("acciones combinadas") — se detiene en el primer
 * paso que falle, nunca sigue a ciegas (mismo criterio de seguridad física
 * que el resto del proyecto). Un job de un solo paso es simplemente
 * `steps` con un elemento — no hay caso especial.
 */
export interface ScheduledJob {
  id: string;
  steps: TaskRequest[];
  /** Se dispara después de correr los `steps`, hayan terminado bien o mal. */
  notification?: JobNotification;
  /** Sintaxis de node-cron (incluye segundos opcionales como primer campo). */
  cron?: string;
  /** ISO 8601 — ejecución única, debe ser una fecha futura al crear el job. */
  runAt?: string;
  /**
   * Usuario que creó el job (P7, ADR-040) — opcional porque `ScheduledJob`
   * quedó, a propósito, fuera del alcance de la autorización por owner
   * (ADR-033). Se usa solo para decidir a quién mandarle el push al
   * disparar `notification`; jobs sin `createdBy` (creados antes de este
   * incremento) degradan a sin-push, nunca a error.
   */
  createdBy?: string;
}
