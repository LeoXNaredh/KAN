import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GatewayTask } from "../domain/entities/GatewayTask";
import type { TaskStorePort } from "../domain/ports/TaskStorePort";

/**
 * Mismo patrón que `JsonFileScheduledJobStore`/`JsonFileAgentRegistryStore`:
 * un único archivo JSON, reescritura completa en cada mutación — el volumen
 * de tareas vivas a la vez (no las resueltas hace rato, esas se podan igual
 * que en memoria) es chico.
 */
export class JsonFileTaskStore implements TaskStorePort {
  private tasks: Record<string, GatewayTask>;

  constructor(private readonly filePath: string) {
    this.tasks = this.readFromDisk();
  }

  load(): GatewayTask[] {
    return Object.values(this.tasks);
  }

  save(task: GatewayTask): void {
    this.tasks[task.id] = task;
    this.persist();
  }

  remove(taskId: string): void {
    delete this.tasks[taskId];
    this.persist();
  }

  private readFromDisk(): Record<string, GatewayTask> {
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
    writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), "utf-8");
  }
}
