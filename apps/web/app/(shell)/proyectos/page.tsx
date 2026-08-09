import { ProjectList } from "@/components/proyectos/ProjectList";
import { buildProjectsUseCases } from "@/lib/projects/composition";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

export default async function ProyectosPage() {
  const user = await getCurrentUserCached();
  const projects = user ? await (await buildProjectsUseCases()).listProjects.execute(user.userId) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Proyectos</h1>
        <p className="text-sm text-ink-faint">
          Organiza tu trabajo por proyecto: modelos, piezas, automatizaciones y conversaciones relacionadas.
        </p>
      </div>

      <ProjectList projects={projects} />
    </div>
  );
}
