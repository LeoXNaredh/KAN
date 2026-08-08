import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushTokenStorePort } from "@kan/core";

interface PushTokenRow {
  token: string;
}

/** Adaptador de PushTokenStorePort sobre la tabla `push_tokens` (P7, ADR-040). */
export class SupabasePushTokenStore implements PushTokenStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async register(userId: string, token: string, platform: "ios" | "android"): Promise<void> {
    const { error } = await this.client
      .from("push_tokens")
      .upsert({ user_id: userId, token, platform }, { onConflict: "user_id,token" });
    if (error) throw new Error(error.message);
  }

  async list(userId: string): Promise<string[]> {
    const { data, error } = await this.client.from("push_tokens").select("token").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PushTokenRow[]).map((row) => row.token);
  }

  async remove(userId: string, token: string): Promise<void> {
    const { error } = await this.client.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
    if (error) throw new Error(error.message);
  }
}
