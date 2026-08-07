import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { ScheduledJobStorePort } from "../domain/ports/ScheduledJobStorePort";

/** Sin persistencia real — para tests o para correr sin sobrevivir un reinicio. */
export class InMemoryScheduledJobStore implements ScheduledJobStorePort {
  private readonly jobs = new Map<string, ScheduledJob>();

  load(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  save(job: ScheduledJob): void {
    this.jobs.set(job.id, job);
  }

  remove(jobId: string): void {
    this.jobs.delete(jobId);
  }
}
