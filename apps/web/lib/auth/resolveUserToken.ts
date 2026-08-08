import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractBearerToken } from "./extractBearerToken";

/**
 * P2 incremento 2 (docs/19): el JWT a reenviar al Gateway como
 * `X-User-Token`. Bearer explícito primero (cliente sin cookies, ej.
 * apps/mobile); si no hay, cae a la sesión de cookies de apps/web. Nunca
 * lanza — `undefined` ante cualquier fallo o ausencia de sesión, mismo
 * criterio que `getCurrentUserCached()`.
 */
export async function resolveUserToken(request: Request): Promise<string | undefined> {
  const bearer = extractBearerToken(request);
  if (bearer) return bearer;

  try {
    const client = await createSupabaseServerClient();
    const { data } = await client.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}
