import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * JWT de la sesión de cookies actual, para Server Components que necesitan
 * mandarlo al Gateway como `X-User-Token` (P1.3, /logs) — mismo criterio de
 * fallback que resolveUserToken.ts, pero sin `Request` (no aplica en un
 * Server Component). `cache()` por request, igual que getCurrentUserCached.
 */
export const getCurrentUserTokenCached = cache(async (): Promise<string | undefined> => {
  try {
    const client = await createSupabaseServerClient();
    const { data } = await client.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
});
