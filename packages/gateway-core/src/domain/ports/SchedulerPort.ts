import type { ScheduledJob } from "../entities/ScheduledJob";

export interface SchedulerPort {
  schedule(job: Omit<ScheduledJob, "id">): string;
  cancel(jobId: string): void;
  list(): ScheduledJob[];
}
