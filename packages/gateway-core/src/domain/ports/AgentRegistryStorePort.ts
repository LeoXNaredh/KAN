import type { AgentRecord } from "../entities/AgentRecord";

/**
 * Persistencia de `AgentRecord` (fix de auditoría de backend #2) — sin
 * esto, `AgentRegistry` es un `Map` puro en memoria y el Dashboard muestra
 * "sin dispositivos" tras cada reinicio del Gateway hasta que cada Edge
 * Agent reconecta y resincroniza. Un adaptador concreto la usa para
 * sobrevivir un reinicio; qué hacer con el `status` cargado (nunca puede
 * ser "online" de verdad hasta que el Edge Agent reconecte) es decisión de
 * `AgentRegistry`, no de este puerto — mismo criterio que
 * `ScheduledJobStorePort`.
 */
export interface AgentRegistryStorePort {
  load(): AgentRecord[];
  save(record: AgentRecord): void;
  remove(edgeAgentId: string): void;
}
