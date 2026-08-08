import type { MemoryEntry } from "../entities/MemoryEntry";

/**
 * Puerto angosto que SÍ conoce SendMessageUseCase — sin `userId` porque quien
 * lo inyecta ya lo construye pre-escopeado a un usuario (mismo patrón que
 * `ToolProviderPort`). Ver UserScopedMemoryContext para el adaptador genérico
 * que envuelve cualquier MemoryStorePort para exponer esto.
 *
 * `set`/`remove` (ADR-035): además de contexto de lectura para el
 * systemPrompt, este puerto respalda las tools internas kan_set_memory/
 * kan_remove_memory — memoria activa, sin pasar por Gateway/Edge Agent.
 */
export interface MemoryContextPort {
  listRelevant(): Promise<MemoryEntry[]>;
  set(category: string, key: string, value: unknown): Promise<MemoryEntry>;
  remove(category: string, key: string): Promise<void>;
}
