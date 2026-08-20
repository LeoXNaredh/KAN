"use server";

import { SupabaseWebPushSubscriptionStore } from "@kan/supabase-adapter";
import type { WebPushSubscription } from "@kan/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

/**
 * Suscripción de Web Push — escribe directo a Supabase con la sesión propia
 * del usuario (anon key + RLS, `web_push_subscriptions_manage_own`), mismo
 * criterio que `registerPushToken` en `apps/mobile`: sin pasar por el
 * Gateway, no hace falta service_role para esto (el usuario solo gestiona
 * sus propias filas).
 */
export async function subscribeToPush(subscription: WebPushSubscription): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserCached();
  if (!user) return { ok: false, error: "Sesión requerida." };

  try {
    const client = await createSupabaseServerClient();
    await new SupabaseWebPushSubscriptionStore(client).register(user.userId, subscription);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo activar las notificaciones." };
  }
}

export async function unsubscribeFromPush(endpoint: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserCached();
  if (!user) return { ok: false, error: "Sesión requerida." };

  try {
    const client = await createSupabaseServerClient();
    await new SupabaseWebPushSubscriptionStore(client).remove(user.userId, endpoint);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo desactivar las notificaciones." };
  }
}
