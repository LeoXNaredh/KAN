import type { MemoryStorePort } from "../../domain/ports/MemoryStorePort";

export class RemoveMemoryUseCase {
  constructor(private readonly memoryStore: MemoryStorePort) {}

  execute(userId: string, category: string, key: string): Promise<void> {
    return this.memoryStore.remove(userId, category, key);
  }
}
