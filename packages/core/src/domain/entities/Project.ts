/** Proyecto de usuario (docs/17, tabla `projects` — ver supabase/migrations/0005_projects.sql). */
export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
