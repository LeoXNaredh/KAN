import type { AuditEntry } from "../entities/AuditEntry";

/**
 * Async desde ADR-026 (docs/16 P3): un adaptador real (Supabase) hace
 * network I/O, no puede cumplir un contrato síncrono. `AuditService.record()`
 * sigue sin esperar `append()` (best-effort, nunca bloquea el flujo que
 * audita) — solo `list()` se propaga como async hacia sus consumidores.
 */
export interface AuditStorePort {
  append(entry: AuditEntry): Promise<void>;
  list(filter?: Partial<Pick<AuditEntry, "actor" | "action" | "subject" | "userId">>): Promise<AuditEntry[]>;
}
