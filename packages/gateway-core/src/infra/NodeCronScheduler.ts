import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import type { LoggerPort } from "@kan/plugin-contract";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { SchedulerDispatch, SchedulerPort } from "../domain/ports/SchedulerPort";
import type { ScheduledJobStorePort } from "../domain/ports/ScheduledJobStorePort";
import { ConsoleLogger } from "./ConsoleLogger";

interface WiredJob {
  job: ScheduledJob;
  cronTask?: ScheduledTask;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Scheduler real (P6, ADR-019): jobs recurrentes vía `cron` (sintaxis de
 * node-cron, segundos opcionales) o de una sola vez vía `runAt`,
 * persistidos con `ScheduledJobStorePort` para sobrevivir un reinicio del
 * Gateway. Nunca dispara nada hasta que `start(dispatch)` se llama.
 *
 * Seguridad: KAN puede controlar hardware físico real (ADR-004). Un job de
 * una sola vez cuyo `runAt` ya pasó mientras el Gateway estaba apagado NO se
 * dispara retroactivamente al reiniciar — se descarta con un warning en el
 * log. Disparar una acción física "tarde" sin que el usuario lo espere es
 * peor que no dispararla.
 */
export class NodeCronScheduler implements SchedulerPort {
  private readonly wired = new Map<string, WiredJob>();
  private dispatch: SchedulerDispatch | undefined;

  constructor(
    private readonly store: ScheduledJobStorePort,
    private readonly logger: LoggerPort = new ConsoleLogger(),
  ) {
    for (const job of this.store.load()) {
      this.wired.set(job.id, { job });
    }
  }

  schedule(input: Omit<ScheduledJob, "id">): string {
    validateJobInput(input);

    const job: ScheduledJob = { ...input, id: randomUUID() };
    this.store.save(job);
    this.wired.set(job.id, { job });
    if (this.dispatch) this.wire(job);
    return job.id;
  }

  cancel(jobId: string): void {
    const wired = this.wired.get(jobId);
    if (!wired) return;
    wired.cronTask?.stop();
    if (wired.timeout) clearTimeout(wired.timeout);
    this.wired.delete(jobId);
    this.store.remove(jobId);
  }

  list(): ScheduledJob[] {
    return Array.from(this.wired.values()).map((wired) => wired.job);
  }

  start(dispatch: SchedulerDispatch): void {
    this.dispatch = dispatch;
    for (const wired of Array.from(this.wired.values())) {
      if (wired.job.runAt && new Date(wired.job.runAt).getTime() <= Date.now()) {
        this.logger.warn(
          `[NodeCronScheduler] Job ${wired.job.id} (runAt=${wired.job.runAt}) venció mientras el Gateway estaba apagado — se descarta sin disparar.`,
        );
        this.wired.delete(wired.job.id);
        this.store.remove(wired.job.id);
        continue;
      }
      this.wire(wired.job);
    }
  }

  stop(): void {
    for (const wired of this.wired.values()) {
      wired.cronTask?.stop();
      if (wired.timeout) clearTimeout(wired.timeout);
    }
    this.dispatch = undefined;
  }

  private wire(job: ScheduledJob): void {
    const dispatch = this.dispatch;
    if (!dispatch) return;
    const wired = this.wired.get(job.id);
    if (!wired) return;

    if (job.cron) {
      wired.cronTask = cron.schedule(job.cron, () => {
        dispatch(job).catch((error) => {
          this.logger.error(`[NodeCronScheduler] job ${job.id} falló al despachar:`, { error });
        });
      });
      return;
    }

    if (job.runAt) {
      const delay = new Date(job.runAt).getTime() - Date.now();
      wired.timeout = setTimeout(() => {
        this.wired.delete(job.id);
        this.store.remove(job.id);
        dispatch(job).catch((error) => {
          this.logger.error(`[NodeCronScheduler] job ${job.id} falló al despachar:`, { error });
        });
      }, delay);
    }
  }
}

function validateJobInput(input: Omit<ScheduledJob, "id">): void {
  if (!input.steps || input.steps.length === 0) {
    throw new Error("Un job programado necesita al menos un paso ('steps').");
  }
  for (const step of input.steps) {
    if (!step.capabilityRef || !step.capabilityRef.trim()) {
      throw new Error("Cada paso necesita un 'capabilityRef' no vacío.");
    }
  }
  if (input.notification && (!input.notification.title.trim() || !input.notification.body.trim())) {
    throw new Error("La notificación necesita 'title' y 'body' no vacíos.");
  }
  if (!input.cron && !input.runAt) {
    throw new Error("Un job programado necesita 'cron' o 'runAt'.");
  }
  if (input.cron && input.runAt) {
    throw new Error("Un job programado no puede tener 'cron' y 'runAt' a la vez.");
  }
  if (input.cron && !cron.validate(input.cron)) {
    throw new Error(`Expresión cron inválida: ${input.cron}`);
  }
  if (input.runAt && new Date(input.runAt).getTime() <= Date.now()) {
    throw new Error("'runAt' debe ser una fecha futura.");
  }
}
