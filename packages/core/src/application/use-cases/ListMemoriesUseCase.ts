import type { MemoryStorePort } from "../../domain/ports/MemoryStorePort";
import type { MemoryEntry } from "../../domain/entities/MemoryEntry";

export class ListMemoriesUseCase {
  constructor(private readonly memoryStore: MemoryStorePort) {}

  execute(userId: string, category?: string): Promise<MemoryEntry[]> {
    return this.memoryStore.list(userId, category);
  }
}
