import type { ProjectsPort } from "../../domain/ports/ProjectsPort";
import type { Project } from "../../domain/entities/Project";

export class ListProjectsUseCase {
  constructor(private readonly projectsPort: ProjectsPort) {}

  execute(userId: string): Promise<Project[]> {
    return this.projectsPort.list(userId);
  }
}
