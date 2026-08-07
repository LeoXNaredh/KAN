import { ListMemoriesUseCase, SetMemoryUseCase, RemoveMemoryUseCase } from "@kan/core";
import { SupabaseMemoryStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Composition root de memoria (P0.2) — mismo rol que lib/auth/composition.ts. */
export async function buildMemoryUseCases() {
  const client = await createSupabaseServerClient();
  const memoryStore = new SupabaseMemoryStore(client);

  return {
    listMemories: new ListMemoriesUseCase(memoryStore),
    setMemory: new SetMemoryUseCase(memoryStore),
    removeMemory: new RemoveMemoryUseCase(memoryStore),
  };
}
