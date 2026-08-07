import { ListPreferencesUseCase, SetPreferenceUseCase, RemovePreferenceUseCase } from "@kan/core";
import { SupabaseUserPreferencesStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Composition root de preferencias — mismo rol que lib/memory/composition.ts. */
export async function buildPreferencesUseCases() {
  const client = await createSupabaseServerClient();
  const preferencesStore = new SupabaseUserPreferencesStore(client);

  return {
    listPreferences: new ListPreferencesUseCase(preferencesStore),
    setPreference: new SetPreferenceUseCase(preferencesStore),
    removePreference: new RemovePreferenceUseCase(preferencesStore),
  };
}
