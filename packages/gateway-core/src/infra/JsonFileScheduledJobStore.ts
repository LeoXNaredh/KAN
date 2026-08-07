import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { ScheduledJobStorePort } from "../domain/ports/ScheduledJobStorePort";

/**
 * Definiciones de jobs persistidas en un único archivo JSON (mismo patrón
 * que `JsonFileConfigStore` en edge-agent-core) — reescritura completa en
 * cada mutación, suficiente para el volumen de jobs esperado (docenas, no
 * miles). Guarda la *definición* del job; qué hacer con uno vencido al
 * recargar es responsabilidad de `NodeCronScheduler`, no de este store.
 */
export class JsonFileScheduledJobStore implements ScheduledJobStorePort {
  private jobs: Record<string, ScheduledJob>;

  constructor(private readonly filePath: string) {
    this.jobs = this.readFromDisk();
  }

  load(): ScheduledJob[] {
    return Object.values(this.jobs);
  }

  save(job: ScheduledJob): void {
    this.jobs[job.id] = job;
    this.persist();
  }

  remove(jobId: string): void {
    delete this.jobs[jobId];
    this.persist();
  }

  private readFromDisk(): Record<string, ScheduledJob> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.jobs, null, 2), "utf-8");
  }
}
