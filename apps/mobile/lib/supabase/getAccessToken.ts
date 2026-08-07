import { supabase } from "./client";

/**
 * ADR-029 (docs/00): el access_token de la sesión actual, para mandarlo
 * como `Authorization: Bearer <token>` a /api/chat. Se pide fresco en cada
 * llamada (no cacheado en estado de React) — `getSession()` lee de
 * AsyncStorage/memoria, sin round-trip de red salvo que haga falta
 * refrescar, así que sigue siendo rápido, y evita mandar un token vencido
 * si pasó tiempo desde el último evento de `onAuthStateChange`.
 */
export async function getAccessToken(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}
