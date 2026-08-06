import { randomUUID } from "node:crypto";
import type { AuditEntry } from "../domain/entities/AuditEntry";
import type { AuditStorePort } from "../domain/ports/AuditStorePort";
import type { GatewayBus } from "./GatewayBus";

export class AuditService {
  constructor(
    private readonly store: AuditStorePort,
    private readonly bus: GatewayBus,
  ) {}

  record(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
    const full: AuditEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    this.store.append(full);
    this.bus.emit("audit.recorded", { entry: full });
    return full;
  }

  list(filter?: Partial<Pick<AuditEntry, "actor" | "action" | "subject">>): AuditEntry[] {
    return this.store.list(filter);
  }
}
