import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserPreference, UserPreferencesPort } from "@kan/core";

interface PreferenceRow {
  user_id: string;
  key: string;
  value: unknown;
  updated_at: string;
}

function toUserPreference(row: PreferenceRow): UserPreference {
  return { userId: row.user_id, key: row.key, value: row.value, updatedAt: row.updated_at };
}

/** Adaptador de UserPreferencesPort sobre la tabla `user_preferences` (P0.1, sin uso hasta ahora). */
export class SupabaseUserPreferencesStore implements UserPreferencesPort {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string): Promise<UserPreference[]> {
    const { data, error } = await this.client.from("user_preferences").select("*").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PreferenceRow[]).map(toUserPreference);
  }

  async get(userId: string, key: string): Promise<UserPreference | undefined> {
    const { data, error } = await this.client
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toUserPreference(data as PreferenceRow) : undefined;
  }

  async set(userId: string, key: string, value: unknown): Promise<UserPreference> {
    const { data, error } = await this.client
      .from("user_preferences")
      .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toUserPreference(data as PreferenceRow);
  }

  async remove(userId: string, key: string): Promise<void> {
    const { error } = await this.client.from("user_preferences").delete().eq("user_id", userId).eq("key", key);
    if (error) throw new Error(error.message);
  }
}
