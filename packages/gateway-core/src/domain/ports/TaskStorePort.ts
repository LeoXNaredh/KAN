import type { GatewayTask } from "../entities/GatewayTask";

/**
 * Persistencia de `GatewayTask` (fix de auditoría de backend #2) — sin
 * esto, una tarea despachada justo antes de que el Gateway se reinicie
 * (típicamente un step de un job programado, sin ningún request HTTP en
 * vuelo esperándola) desaparece sin dejar rastro: ni éxito ni error, un
 * silencio total. Con esto, `TaskOrchestrator` reconcilia al arrancar
 * cualquier tarea que haya quedado en "dispatched" — la resuelve a
 * "failed" con una razón explícita en vez de dejarla en un limbo eterno.
 */
export interface TaskStorePort {
  load(): GatewayTask[];
  save(task: GatewayTask): void;
  remove(taskId: string): void;
}
