import type { ScheduledJob } from "../entities/ScheduledJob";
import type { TaskRequest, TaskResult } from "../entities/GatewayTask";

/** Invocado por el scheduler cuando un job vence — quien la implementa (Gateway) decide qué hacer con el resultado. */
export type SchedulerDispatch = (taskRequest: TaskRequest, jobId: string) => Promise<TaskResult>;

export interface SchedulerPort {
  /** Lanza si el job es inválido (ni cron ni runAt, ambos a la vez, cron mal formado, o runAt no futuro). */
  schedule(job: Omit<ScheduledJob, "id">): string;
  cancel(jobId: string): void;
  list(): ScheduledJob[];
  /** Empieza a disparar jobs vencidos vía `dispatch`. Antes de llamar esto, ningún job se ejecuta. */
  start(dispatch: SchedulerDispatch): void;
  stop(): void;
}
