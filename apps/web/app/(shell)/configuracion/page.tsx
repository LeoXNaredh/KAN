import Link from "next/link";
import { User, Brain, Sparkles, Volume2, Puzzle } from "lucide-react";
import { GEMINI_TTS_VOICES, DEFAULT_VOICE } from "@kan/voice-abstraction";
import { Card } from "@/components/ui/Card";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { MemoryManager } from "@/components/configuracion/MemoryManager";
import { PluginConfigManager } from "@/components/configuracion/PluginConfigManager";
import { buildAuthUseCases } from "@/lib/auth/composition";
import { updateDisplayNameAction } from "@/lib/auth/actions";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildMemoryUseCases } from "@/lib/memory/composition";
import { buildPreferencesUseCases } from "@/lib/preferences/composition";
import { updatePersonalityAction, updateVoiceAction } from "@/lib/preferences/actions";

const PLUGIN_CONFIG_KEY_PREFIX = "plugin_config:";

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
  const voicePreference = preferences.find((preference) => preference.key === "ttsVoice")?.value;
  const voice = typeof voicePreference === "string" ? voicePreference : DEFAULT_VOICE;
  // Mismo `preferences` ya cargado arriba — sin fetch extra. `plugin_config:*`
  // conviven con el resto de las preferencias en la misma tabla
  // (user_preferences), namespaced por prefijo (ver
  // apps/web/lib/pluginConfig/actions.ts y SupabasePairingStore del Gateway,
  // que lee este mismo prefijo al aparear/sincronizar el Edge Agent).
  const pluginConfigValues = Object.fromEntries(
    preferences
      .filter((preference) => preference.key.startsWith(PLUGIN_CONFIG_KEY_PREFIX))
      .map((preference) => [preference.key.slice(PLUGIN_CONFIG_KEY_PREFIX.length), String(preference.value ?? "")]),
  );

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
            <Volume2 className="h-4 w-4" aria-hidden="true" />
            Voz
          </h2>
          <p className="text-xs text-ink-faint">
            La voz que usa KAN para leerte sus respuestas en voz alta (ADR-042).
          </p>

          <form action={updateVoiceAction} className="flex flex-col gap-2">
            <select name="voice" defaultValue={voice} className={INPUT_CLASSES}>
              {GEMINI_TTS_VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} — {v.style}
                </option>
              ))}
            </select>
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
            Hechos que KAN tiene en cuenta en cada conversación. KAN los guarda solo cuando se lo pedís en el
            chat (&quot;recordá que...&quot;) — acá podés agregarlos, editarlos o borrarlos a mano también.
          </p>

          <MemoryManager memories={memories} />
        </Card>
      )}

      {user && (
        <div id="plugins">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink-muted">
            <Puzzle className="h-4 w-4" aria-hidden="true" />
            Plugins de hardware
          </h2>
          <p className="mb-3 text-xs text-ink-faint">
            Conexiones de cada plugin (hosts SSH, brokers MQTT, targets Modbus, etc.) — sin editar ningún archivo a
            mano. Un Edge Agent ya vinculado las trae al aparear, o con &quot;Sincronizar configuración&quot; en la
            app de escritorio. ¿Todavía no vinculaste ninguno?{" "}
            <Link href="/dispositivos" className="text-accent hover:underline">
              Hacelo en Dispositivos
            </Link>
            .
          </p>
          <PluginConfigManager values={pluginConfigValues} />
        </div>
      )}

      <PlaceholderPage title="Proveedores de IA" description="Elegir proveedor de IA y notificaciones llega en un incremento futuro." />
    </div>
  );
}
