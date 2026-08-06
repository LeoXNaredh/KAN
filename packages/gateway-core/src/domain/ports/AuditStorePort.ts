import type { AuditEntry } from "../entities/AuditEntry";

export interface AuditStorePort {
  append(entry: AuditEntry): void;
  list(filter?: Partial<Pick<AuditEntry, "actor" | "action" | "subject">>): AuditEntry[];
}
