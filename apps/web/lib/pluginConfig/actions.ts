"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildPluginConfigUseCases } from "./composition";

/** Mismo prefijo que lee `SupabasePairingStore.fetchPluginConfig` (packages/supabase-adapter) del lado del Gateway. */
const PLUGIN_CONFIG_KEY_PREFIX = "plugin_config:";

/**
 * Guarda (o borra, si `value` queda vacío) el valor de una variable
 * `KAN_*` — mismo patrón que `updatePersonalityAction`/`updateVoiceAction`
 * (`lib/preferences/actions.ts`). Para campos "list" (`PluginConfigField`),
 * `value` ya viene unido con coma desde `PluginConfigManager` — el server
 * action no sabe ni le importa si es una lista o un escalar, guarda el
 * string tal cual, exactamente lo mismo que el plugin va a leer de
 * `process.env`.
 */
export async function setPluginConfigAction(formData: FormData) {
  const envVar = String(formData.get("envVar") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");
  if (!envVar) redirect("/configuracion");

  const { setPreference, removePreference } = await buildPluginConfigUseCases();
  const key = `${PLUGIN_CONFIG_KEY_PREFIX}${envVar}`;
  if (value) {
    await setPreference.execute(user.userId, key, value);
  } else {
    await removePreference.execute(user.userId, key);
  }
  redirect("/configuracion?updated=1");
}
