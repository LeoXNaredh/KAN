import type { TaskRequest } from "./GatewayTask";

/** Seam (docs/12 §8) — sin ejecución real todavía, ver NoopScheduler. */
export interface ScheduledJob {
  id: string;
  taskRequest: TaskRequest;
  cron?: string;
  runAt?: string;
}
