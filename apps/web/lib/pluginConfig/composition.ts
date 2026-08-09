import { ListPreferencesUseCase, SetPreferenceUseCase, RemovePreferenceUseCase } from "@kan/core";
import { SupabaseUserPreferencesStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Composition root de config de plugins — reusa `user_preferences` (mismo
 * store que ya usan Personalidad/Voz en /configuracion, `lib/preferences/
 * composition.ts`), sin tabla ni adapter nuevo. Namespacing por prefijo
 * (`plugin_config:<KAN_ENV_VAR>`, ver `SupabasePairingStore.fetchPluginConfig`
 * del lado del Gateway, que lee este mismo prefijo).
 */
export async function buildPluginConfigUseCases() {
  const client = await createSupabaseServerClient();
  const preferencesStore = new SupabaseUserPreferencesStore(client);

  return {
    listPreferences: new ListPreferencesUseCase(preferencesStore),
    setPreference: new SetPreferenceUseCase(preferencesStore),
    removePreference: new RemovePreferenceUseCase(preferencesStore),
  };
}
