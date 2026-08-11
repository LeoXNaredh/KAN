import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentRecord } from "../domain/entities/AgentRecord";
import type { AgentRegistryStorePort } from "../domain/ports/AgentRegistryStorePort";

/**
 * Mismo patrón que `JsonFileScheduledJobStore`: un único archivo JSON,
 * reescritura completa en cada mutación — de sobra para el volumen esperado
 * (unos pocos Edge Agents por usuario, no miles).
 */
export class JsonFileAgentRegistryStore implements AgentRegistryStorePort {
  private records: Record<string, AgentRecord>;

  constructor(private readonly filePath: string) {
    this.records = this.readFromDisk();
  }

  load(): AgentRecord[] {
    return Object.values(this.records);
  }

  save(record: AgentRecord): void {
    this.records[record.edgeAgentId] = record;
    this.persist();
  }

  remove(edgeAgentId: string): void {
    delete this.records[edgeAgentId];
    this.persist();
  }

  private readFromDisk(): Record<string, AgentRecord> {
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
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), "utf-8");
  }
}
