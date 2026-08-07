import type { ScheduledJob } from "../entities/ScheduledJob";

/**
 * Persistencia de la definición de los jobs programados (P6, ADR-019) — no
 * de su ejecución. Un `SchedulerPort` concreto la usa para sobrevivir un
 * reinicio del Gateway; qué pasa con un job vencido durante el reinicio es
 * decisión del scheduler, no de este puerto.
 */
export interface ScheduledJobStorePort {
  load(): ScheduledJob[];
  save(job: ScheduledJob): void;
  remove(jobId: string): void;
}
