import type { ProjectsPort } from "../../domain/ports/ProjectsPort";
import type { Project } from "../../domain/entities/Project";

export class CreateProjectUseCase {
  constructor(private readonly projectsPort: ProjectsPort) {}

  execute(userId: string, name: string, description?: string): Promise<Project> {
    return this.projectsPort.create(userId, name, description);
  }
}
