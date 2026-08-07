import type { MemoryEntry } from "../entities/MemoryEntry";

/** CRUD completo de memoria estructurada (ADR-015) — usado por la gestión manual en /configuracion. */
export interface MemoryStorePort {
  list(userId: string, category?: string): Promise<MemoryEntry[]>;
  set(userId: string, category: string, key: string, value: unknown): Promise<MemoryEntry>;
  remove(userId: string, category: string, key: string): Promise<void>;
}
