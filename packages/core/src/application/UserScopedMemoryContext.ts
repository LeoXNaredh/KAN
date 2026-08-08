import type { MemoryStorePort } from "../domain/ports/MemoryStorePort";
import type { MemoryContextPort } from "../domain/ports/MemoryContextPort";
import type { MemoryEntry } from "../domain/entities/MemoryEntry";

/**
 * Envuelve cualquier MemoryStorePort (Supabase hoy, cualquier otro backend
 * mañana) + un userId fijo para exponer MemoryContextPort — no es
 * específico de ningún proveedor, vive en core a propósito.
 */
export class UserScopedMemoryContext implements MemoryContextPort {
  constructor(
    private readonly store: MemoryStorePort,
    private readonly userId: string,
  ) {}

  listRelevant(): Promise<MemoryEntry[]> {
    return this.store.list(this.userId);
  }

  set(category: string, key: string, value: unknown): Promise<MemoryEntry> {
    return this.store.set(this.userId, category, key, value);
  }

  remove(category: string, key: string): Promise<void> {
    return this.store.remove(this.userId, category, key);
  }
}
