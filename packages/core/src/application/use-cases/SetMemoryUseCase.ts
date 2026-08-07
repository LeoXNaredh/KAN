import type { MemoryStorePort } from "../../domain/ports/MemoryStorePort";
import type { MemoryEntry } from "../../domain/entities/MemoryEntry";

export class SetMemoryUseCase {
  constructor(private readonly memoryStore: MemoryStorePort) {}

  execute(userId: string, category: string, key: string, value: unknown): Promise<MemoryEntry> {
    return this.memoryStore.set(userId, category, key, value);
  }
}
