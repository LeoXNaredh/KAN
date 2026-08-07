import { cache } from "react";
import type { UserIdentity } from "@kan/core";
import { buildAuthUseCases } from "./composition";

/**
 * `cache()` de React dedupe esta llamada dentro de una misma request — el
 * shell (layout) y la página que renderiza dentro de él (Dashboard,
 * Configuración) piden "quién es el usuario actual" de forma independiente,
 * pero solo se habla con Supabase una vez por request.
 */
export const getCurrentUserCached = cache(async (): Promise<UserIdentity | undefined> => {
  try {
    const { getCurrentUser } = await buildAuthUseCases();
    return await getCurrentUser.execute();
  } catch {
    // Sin credenciales de Supabase configuradas todavía, o cualquier otro
    // fallo hablando con Supabase: se trata como "sin sesión", no se rompe
    // el render (mismo criterio que /api/status).
    return undefined;
  }
});
