import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryEntry, MemoryStorePort } from "@kan/core";

interface MemoryRow {
  user_id: string;
  category: string;
  key: string;
  value: unknown;
  updated_at: string;
}

function toMemoryEntry(row: MemoryRow): MemoryEntry {
  return { userId: row.user_id, category: row.category, key: row.key, value: row.value, updatedAt: row.updated_at };
}

/** Adaptador de MemoryStorePort sobre la tabla `memories` (ADR-015/ADR-017, P0.2). */
export class SupabaseMemoryStore implements MemoryStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string, category?: string): Promise<MemoryEntry[]> {
    const base = this.client.from("memories").select("*").eq("user_id", userId);
    const { data, error } = category ? await base.eq("category", category) : await base;
    if (error) throw new Error(error.message);
    return ((data ?? []) as MemoryRow[]).map(toMemoryEntry);
  }

  async set(userId: string, category: string, key: string, value: unknown): Promise<MemoryEntry> {
    const { data, error } = await this.client
      .from("memories")
      .upsert(
        { user_id: userId, category, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,category,key" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toMemoryEntry(data as MemoryRow);
  }

  async remove(userId: string, category: string, key: string): Promise<void> {
    const { error } = await this.client
      .from("memories")
      .delete()
      .eq("user_id", userId)
      .eq("category", category)
      .eq("key", key);
    if (error) throw new Error(error.message);
  }
}
