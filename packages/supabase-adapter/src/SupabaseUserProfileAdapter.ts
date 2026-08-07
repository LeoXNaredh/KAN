import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardSummary, UserProfile, UserProfilePort } from "@kan/core";

interface ProfileRow {
  id: string;
  display_name: string | null;
  created_at: string;
}

function toUserProfile(row: ProfileRow): UserProfile {
  return { userId: row.id, displayName: row.display_name ?? undefined, createdAt: row.created_at };
}

/**
 * Adaptador de UserProfilePort sobre `@supabase/supabase-js` (ADR-017).
 * Mismo principio que SupabaseAuthAdapter: recibe el cliente por
 * inyección, sin acoplarse a Next.js.
 */
export class SupabaseUserProfileAdapter implements UserProfilePort {
  constructor(private readonly client: SupabaseClient) {}

  async getProfile(userId: string): Promise<UserProfile | undefined> {
    const { data, error } = await this.client.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toUserProfile(data as ProfileRow) : undefined;
  }

  async updateDisplayName(userId: string, displayName: string): Promise<UserProfile> {
    const { data, error } = await this.client
      .from("profiles")
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toUserProfile(data as ProfileRow);
  }

  async getDashboardSummary(userId: string): Promise<DashboardSummary> {
    const [profile, projectsCount, memoriesCount] = await Promise.all([
      this.getProfile(userId),
      this.countRows("projects", userId),
      this.countRows("memories", userId),
    ]);

    return {
      profile: profile ?? { userId, createdAt: new Date().toISOString() },
      projectsCount,
      memoriesCount,
    };
  }

  private async countRows(table: "projects" | "memories", userId: string): Promise<number> {
    const { count, error } = await this.client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
