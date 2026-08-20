import type { AgentRecord } from "../domain/entities/AgentRecord";
import type { AgentRegistryStorePort } from "../domain/ports/AgentRegistryStorePort";
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

/**
 * En memoria por default; con un `store` (fix de auditoría de backend #2,
 * `JsonFileAgentRegistryStore` en `apps/gateway`) sobrevive un reinicio del
 * Gateway — mismo patrón de adaptador opcional que `NodeCronScheduler` con
 * `ScheduledJobStorePort`. `status` cargado del disco siempre se corrige a
 * "offline" al hidratar: un Edge Agent solo puede ser "online" de verdad
 * mientras exista una conexión WS viva en este proceso, y un registro
 * persistido nunca la tiene (la conexión murió con el proceso anterior) —
 * mentir "online" hasta que reconecte confundiría al Dashboard.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();
  /**
   * Acceso multi-usuario (capa aditiva sobre `ownerId`) — vive solo en
   * memoria, nunca en `AgentRecord`/el store local: la fuente de verdad es
   * Supabase (`edge_agent_grants`), esto es un cache re-hidratado al
   * arrancar el Gateway (`setGrantedUserIds`, llamado desde `server.ts`) y
   * actualizado al toque por las rutas de invitar/revocar — nunca depende
   * de que el Edge Agent se reconecte para que un cambio de acceso surta
   * efecto.
   */
  private readonly grantedUserIds = new Map<string, Set<string>>();

  constructor(
    private readonly bus: GatewayBus,
    private readonly store?: AgentRegistryStorePort,
  ) {
    if (this.store) {
      for (const record of this.store.load()) {
        this.agents.set(record.edgeAgentId, { ...record, status: "offline" });
      }
    }
  }

  upsert(record: AgentRecord): void {
    this.agents.set(record.edgeAgentId, record);
    this.store?.save(record);
    // Limpieza de entradas huérfanas (fix de auditoría de backend #6): se
    // corre al conectar un agente nuevo ("al reconectar"), no con un timer
    // propio — AgentRegistry sigue siendo una clase sin dependencias de
    // scheduling propias.
    this.pruneStaleOffline();
  }

  markOnline(edgeAgentId: string): void {
    const record = this.agents.get(edgeAgentId);
    if (record) {
      record.status = "online";
      record.lastSeenAt = new Date().toISOString();
      this.store?.save(record);
    }
    this.bus.emit("agent.connected", { edgeAgentId });
  }

  markOffline(edgeAgentId: string): void {
    const record = this.agents.get(edgeAgentId);
    if (record) {
      record.status = "offline";
      this.store?.save(record);
    }
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
    return all.filter((record) => this.hasAccess(record.edgeAgentId, requestingUserId));
  }

  setGrantedUserIds(edgeAgentId: string, userIds: string[]): void {
    this.grantedUserIds.set(edgeAgentId, new Set(userIds));
  }

  /** Invitados con acceso a este Edge Agent (sin el dueño) — usado para el fan-out de notificaciones de alertas (AlertMonitor). */
  getGrantedUserIds(edgeAgentId: string): string[] {
    return Array.from(this.grantedUserIds.get(edgeAgentId) ?? []);
  }

  /**
   * Única fuente de verdad de "¿puede este usuario ver/operar este Edge
   * Agent?" — reemplaza el chequeo `ownerId === undefined || ownerId ===
   * requestingUserId` que antes vivía copiado en `GlobalCapabilityRegistry`,
   * `TelemetryHistoryStore`, `ConfirmationOrchestrator` y
   * `Gateway.executeSingleCapability()`. Sin dueño (agente sin vincular
   * todavía), sigue abierto para cualquiera — mismo criterio de siempre.
   */
  hasAccess(edgeAgentId: string, requestingUserId?: string): boolean {
    if (requestingUserId === undefined) return true;
    const ownerId = this.agents.get(edgeAgentId)?.ownerId;
    if (ownerId === undefined || ownerId === requestingUserId) return true;
    return this.grantedUserIds.get(edgeAgentId)?.has(requestingUserId) ?? false;
  }

  private pruneStaleOffline(): void {
    const now = Date.now();
    for (const [edgeAgentId, record] of this.agents) {
      if (record.status !== "offline") continue;
      if (now - new Date(record.lastSeenAt).getTime() > STALE_OFFLINE_MS) {
        this.agents.delete(edgeAgentId);
        this.store?.remove(edgeAgentId);
      }
    }
  }
}
