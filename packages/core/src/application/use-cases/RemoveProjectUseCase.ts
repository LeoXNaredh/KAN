import type { ProjectsPort } from "../../domain/ports/ProjectsPort";

export class RemoveProjectUseCase {
  constructor(private readonly projectsPort: ProjectsPort) {}

  execute(userId: string, id: string): Promise<void> {
    return this.projectsPort.remove(userId, id);
  }
}
