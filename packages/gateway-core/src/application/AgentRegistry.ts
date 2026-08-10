import type { AgentRecord } from "../domain/entities/AgentRecord";
import type { GatewayBus } from "./GatewayBus";

/**
 * Un Edge Agent reinstalado (userData borrado) genera un `edgeAgentId`
 * nuevo — el registro viejo queda offline para siempre, sin ninguna señal
 * en el protocolo (ningún fingerprint de hardware) que permita confirmar
 * con seguridad "esto es el mismo dispositivo" para unificarlos. Podar por
 * tiempo evita ese crecimiento sin límite sin arriesgar borrar un segundo
 * dispositivo real del mismo usuario que simplemente está offline — el
 * plazo es generoso a propósito para no confundir "la laptop está
 * apagada" con "esto ya no existe".
 */
const STALE_OFFLINE_MS = 90 * 24 * 60 * 60 * 1000;

/** In-memory hoy (docs/12 §2) — swap a Supabase es cambio de adaptador, mismo patrón que ADR-007. */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();

  constructor(private readonly bus: GatewayBus) {}

  upsert(record: AgentRecord): void {
    this.agents.set(record.edgeAgentId, record);
    // Limpieza de entradas huérfanas (fix de auditoría de backend #6): se
    // corre al conectar un agente nuevo ("al reconectar"), no con un timer
    // propio — AgentRegistry sigue siendo una clase en memoria sin
    // dependencias de scheduling.
    this.pruneStaleOffline();
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

  /**
   * Sin `requestingUserId`, devuelve todo (retrocompatible — así se
   * comportaba antes de P2 incremento 4). Con él, filtra a los agentes sin
   * owner (todavía no vinculados, abiertos para cualquiera) más los que le
   * pertenecen exactamente a ese usuario.
   */
  list(requestingUserId?: string): AgentRecord[] {
    const all = Array.from(this.agents.values());
    if (requestingUserId === undefined) return all;
    return all.filter((record) => record.ownerId === undefined || record.ownerId === requestingUserId);
  }

  private pruneStaleOffline(): void {
    const now = Date.now();
    for (const [edgeAgentId, record] of this.agents) {
      if (record.status !== "offline") continue;
      if (now - new Date(record.lastSeenAt).getTime() > STALE_OFFLINE_MS) {
        this.agents.delete(edgeAgentId);
      }
    }
  }
}
