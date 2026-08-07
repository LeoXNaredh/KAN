import type { MemoryEntry } from "../entities/MemoryEntry";

/**
 * Puerto angosto que SÍ conoce SendMessageUseCase — sin `userId` porque quien
 * lo inyecta ya lo construye pre-escopeado a un usuario (mismo patrón que
 * `ToolProviderPort`). Ver UserScopedMemoryContext para el adaptador genérico
 * que envuelve cualquier MemoryStorePort para exponer esto.
 */
export interface MemoryContextPort {
  listRelevant(): Promise<MemoryEntry[]>;
}
