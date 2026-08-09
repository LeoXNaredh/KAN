import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectsPort } from "@kan/core";

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Adaptador de ProjectsPort sobre la tabla `projects` (supabase/migrations/0005_projects.sql, P1.3). */
export class SupabaseProjectsAdapter implements ProjectsPort {
  constructor(private readonly client: SupabaseClient) {}

  async list(userId: string): Promise<Project[]> {
    const { data, error } = await this.client
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ProjectRow[]).map(toProject);
  }

  async create(userId: string, name: string, description?: string): Promise<Project> {
    const { data, error } = await this.client
      .from("projects")
      .insert({ user_id: userId, name, description: description ?? null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toProject(data as ProjectRow);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { error } = await this.client.from("projects").delete().eq("user_id", userId).eq("id", id);
    if (error) throw new Error(error.message);
  }
}
