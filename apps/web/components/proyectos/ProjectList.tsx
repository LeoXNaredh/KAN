"use client";

import { Trash2, FolderKanban } from "lucide-react";
import type { Project } from "@kan/core";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { createProjectAction, removeProjectAction } from "@/lib/projects/actions";

/** CRUD manual de proyectos en /proyectos (P1.3) — mismo criterio que MemoryManager.tsx en /configuracion. */
export function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div className="flex flex-col gap-4">
      {projects.length === 0 ? (
        <Card padding="sm" className="fade-in">
          <p className="text-sm text-ink-faint">Sin proyectos todavía — creá el primero abajo.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <Reveal key={project.id} delay={index * 50}>
              <Card padding="sm" interactive className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderKanban className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span className="truncate text-sm font-medium text-ink">{project.name}</span>
                  </div>
                  <form action={removeProjectAction}>
                    <input type="hidden" name="id" value={project.id} />
                    <button
                      type="submit"
                      aria-label={`Eliminar proyecto ${project.name}`}
                      className="press shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </form>
                </div>
                {project.description && <p className="text-xs text-ink-faint">{project.description}</p>}
              </Card>
            </Reveal>
          ))}
        </div>
      )}

      <Card className="fade-in flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-muted">Nuevo proyecto</h2>
        <form action={createProjectAction} className="flex flex-col gap-2 sm:flex-row">
          <input name="name" placeholder="Nombre (ej. Impresora 3D)" required className={`flex-1 ${INPUT_CLASSES}`} />
          <input name="description" placeholder="Descripción (opcional)" className={`flex-1 ${INPUT_CLASSES}`} />
          <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
            Crear
          </button>
        </form>
      </Card>
    </div>
  );
}
