import type { ScheduledJob } from "../entities/ScheduledJob";

/**
 * Invocado por el scheduler cuando un job vence — recibe el job completo
 * (todos sus `steps` + `notification`) porque quien la implementa (Gateway)
 * es responsable de correr la secuencia y, si corresponde, notificar.
 */
export type SchedulerDispatch = (job: ScheduledJob) => Promise<void>;

export interface SchedulerPort {
  /** Lanza si el job es inválido (ni cron ni runAt, ambos a la vez, cron mal formado, o runAt no futuro). */
  schedule(job: Omit<ScheduledJob, "id">): string;
  cancel(jobId: string): void;
  list(): ScheduledJob[];
  /** Empieza a disparar jobs vencidos vía `dispatch`. Antes de llamar esto, ningún job se ejecuta. */
  start(dispatch: SchedulerDispatch): void;
  stop(): void;
}
