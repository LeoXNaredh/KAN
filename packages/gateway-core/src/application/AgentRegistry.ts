import type { AgentRecord } from "../domain/entities/AgentRecord";
import type { GatewayBus } from "./GatewayBus";

/** In-memory hoy (docs/12 §2) — swap a Supabase es cambio de adaptador, mismo patrón que ADR-007. */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();

  constructor(private readonly bus: GatewayBus) {}

  upsert(record: AgentRecord): void {
    this.agents.set(record.edgeAgentId, record);
  }

  markOnline(edgeAgentId: string): void {
    const record = this.agents.get(edgeAgentId);
    if (record) {
      record.status = "online";
      record.lastSeenAt = new Date().toISOString();
    }
    this.bus.emit("agent.connected", { edgeAgentId });
  }

  markOffline(edgeAgentId: string): void {
    const record = this.agents.get(edgeAgentId);
    if (record) record.status = "offline";
    this.bus.emit("agent.disconnected", { edgeAgentId });
  }

  get(edgeAgentId: string): AgentRecord | undefined {
    return this.agents.get(edgeAgentId);
  }

  list(): AgentRecord[] {
    return Array.from(this.agents.values());
  }
}
