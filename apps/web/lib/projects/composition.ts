import { ListProjectsUseCase, CreateProjectUseCase, RemoveProjectUseCase } from "@kan/core";
import { SupabaseProjectsAdapter } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Composition root de proyectos (P1.3) — mismo rol que lib/memory/composition.ts. */
export async function buildProjectsUseCases() {
  const client = await createSupabaseServerClient();
  const projectsPort = new SupabaseProjectsAdapter(client);

  return {
    listProjects: new ListProjectsUseCase(projectsPort),
    createProject: new CreateProjectUseCase(projectsPort),
    removeProject: new RemoveProjectUseCase(projectsPort),
  };
}
