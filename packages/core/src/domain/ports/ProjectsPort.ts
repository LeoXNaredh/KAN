import type { Project } from "../entities/Project";

/** CRUD de proyectos (P1.3) — usado por /proyectos. */
export interface ProjectsPort {
  list(userId: string): Promise<Project[]>;
  create(userId: string, name: string, description?: string): Promise<Project>;
  remove(userId: string, id: string): Promise<void>;
}
