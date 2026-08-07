import { User, Brain, Sparkles, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { buildAuthUseCases } from "@/lib/auth/composition";
import { updateDisplayNameAction } from "@/lib/auth/actions";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildMemoryUseCases } from "@/lib/memory/composition";
import { addMemoryAction, removeMemoryAction } from "@/lib/memory/actions";
import { buildPreferencesUseCases } from "@/lib/preferences/composition";
import { updatePersonalityAction } from "@/lib/preferences/actions";

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUserCached();
  const summary = user ? await (await buildAuthUseCases()).getDashboardSummary.execute(user.userId) : undefined;
  const memories = user ? await (await buildMemoryUseCases()).listMemories.execute(user.userId) : [];
  const preferences = user ? await (await buildPreferencesUseCases()).listPreferences.execute(user.userId) : [];
  const personalityPreference = preferences.find((preference) => preference.key === "personality")?.value;
  const personality = typeof personalityPreference === "string" ? personalityPreference : "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Configuración</h1>
        <p className="text-sm text-ink-faint">Tu perfil y las preferencias de KAN.</p>
      </div>

      {user && (
        <Card className="fade-in flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <User className="h-4 w-4" aria-hidden="true" />
            Perfil
          </h2>

          {params.updated && (
            <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              Nombre actualizado.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-faint">Email</span>
            <span className="text-sm text-ink">{user.email}</span>
          </div>

          <form action={updateDisplayNameAction} className="flex flex-col gap-2">
            <label htmlFor="displayName" className="text-xs text-ink-faint">
              Nombre para mostrar
            </label>
            <div className="flex gap-2">
              <input
                id="displayName"
                name="displayName"
                type="text"
                defaultValue={summary?.profile.displayName ?? ""}
                placeholder="¿Cómo quieres que KAN te llame?"
                className={`flex-1 ${INPUT_CLASSES}`}
              />
              <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
                Guardar
              </button>
            </div>
          </form>
        </Card>
      )}

      {user && (
        <Card className="fade-in flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Personalidad
          </h2>
          <p className="text-xs text-ink-faint">
            Cómo querés que KAN te hable — tono, estilo, límites. Se aplica en cada conversación nueva.
          </p>

          <form action={updatePersonalityAction} className="flex flex-col gap-2">
            <textarea
              name="personality"
              defaultValue={personality}
              placeholder="Ej: Sé directo y breve, sin rodeos. Tono técnico. Nunca uses emojis."
              className={`min-h-[5rem] ${INPUT_CLASSES}`}
            />
            <button type="submit" className={`self-start ${PRIMARY_BUTTON_CLASSES}`}>
              Guardar
            </button>
          </form>
        </Card>
      )}

      {user && (
        <Card className="fade-in flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <Brain className="h-4 w-4" aria-hidden="true" />
            Memoria
          </h2>
          <p className="text-xs text-ink-faint">
            Hechos que KAN tiene en cuenta en cada conversación. Todavía se agregan a mano — el aprendizaje
            automático es un incremento futuro.
          </p>

          {memories.length === 0 ? (
            <p className="text-sm text-ink-faint">Sin memorias guardadas todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {memories.map((memory) => (
                <li
                  key={`${memory.category}:${memory.key}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-surface-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="mr-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-accent uppercase">
                      {memory.category}
                    </span>
                    <span className="font-medium text-ink">{memory.key}</span>
                    <span className="ml-2 text-ink-muted">{String(memory.value)}</span>
                  </div>
                  <form action={removeMemoryAction}>
                    <input type="hidden" name="category" value={memory.category} />
                    <input type="hidden" name="key" value={memory.key} />
                    <button
                      type="submit"
                      aria-label={`Eliminar memoria ${memory.key}`}
                      className="shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={addMemoryAction} className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row">
            <input name="category" placeholder="Categoría (ej. preferencia)" required className={INPUT_CLASSES} />
            <input name="key" placeholder="Clave (ej. unidad_temperatura)" required className={INPUT_CLASSES} />
            <input name="value" placeholder="Valor (ej. celsius)" required className={INPUT_CLASSES} />
            <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
              Agregar
            </button>
          </form>
        </Card>
      )}

      <PlaceholderPage
        title="Proveedores de IA y seguridad"
        description="Elegir proveedor de IA, notificaciones y las políticas de tus dispositivos llegan en un incremento futuro."
      />
    </div>
  );
}
