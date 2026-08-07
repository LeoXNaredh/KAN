import { randomUUID } from "node:crypto";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { SchedulerDispatch, SchedulerPort } from "../domain/ports/SchedulerPort";

/**
 * Scheduler que intencionalmente nunca ejecuta nada — útil para tests o para
 * correr el Gateway sin automatizaciones activas. El scheduler real es
 * `NodeCronScheduler` (P6, ADR-019).
 */
export class NoopScheduler implements SchedulerPort {
  private readonly jobs = new Map<string, ScheduledJob>();

  schedule(job: Omit<ScheduledJob, "id">): string {
    const id = randomUUID();
    this.jobs.set(id, { ...job, id });
    console.warn(`[NoopScheduler] Job ${id} registrado pero NO se ejecutará (usa NodeCronScheduler para ejecución real).`);
    return id;
  }

  cancel(jobId: string): void {
    this.jobs.delete(jobId);
  }

  list(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  start(_dispatch: SchedulerDispatch): void {}

  stop(): void {}
}
