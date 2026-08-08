import { randomUUID } from "node:crypto";
import type { AuditEntry } from "../domain/entities/AuditEntry";
import type { AuditStorePort } from "../domain/ports/AuditStorePort";
import type { GatewayBus } from "./GatewayBus";

export class AuditService {
  constructor(
    private readonly store: AuditStorePort,
    private readonly bus: GatewayBus,
  ) {}

  /**
   * Síncrono a propósito (ADR-026): nunca espera `store.append()` — un
   * fallo o una demora de red en la persistencia de auditoría no debe
   * bloquear ni fallar el flujo que la disparó (tool.execute, un job, un
   * cambio de Safety Policy...). Cada adaptador de `AuditStorePort` es
   * responsable de no rechazar esa promesa (ver `SupabaseAuditStore`).
   */
  record(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
    const full: AuditEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    this.store.append(full);
    this.bus.emit("audit.recorded", { entry: full });
    return full;
  }

  async list(filter?: Partial<Pick<AuditEntry, "actor" | "action" | "subject" | "userId">>): Promise<AuditEntry[]> {
    return this.store.list(filter);
  }
}
