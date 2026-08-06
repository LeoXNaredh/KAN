import { randomUUID } from "node:crypto";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { SchedulerPort } from "../domain/ports/SchedulerPort";

/**
 * Seam del requisito 8 (docs/12 §8). Registra el job pero nunca lo ejecuta —
 * deja constancia explícita en el log en vez de fallar silenciosamente,
 * hasta que exista un caso de uso real que justifique un scheduler de verdad.
 */
export class NoopScheduler implements SchedulerPort {
  private readonly jobs = new Map<string, ScheduledJob>();

  schedule(job: Omit<ScheduledJob, "id">): string {
    const id = randomUUID();
    this.jobs.set(id, { ...job, id });
    console.warn(`[NoopScheduler] Job ${id} registrado pero NO se ejecutará (scheduler no implementado todavía).`);
    return id;
  }

  cancel(jobId: string): void {
    this.jobs.delete(jobId);
  }

  list(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }
}
