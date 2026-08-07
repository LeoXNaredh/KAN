import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export class MissingSupabaseConfigError extends Error {
  constructor(varName: string) {
    super(
      `Falta ${varName}. Copia apps/web/.env.example a apps/web/.env.local y agrega tus credenciales de Supabase (ver DESIGN_SYSTEM.md / README del proyecto para los pasos exactos).`,
    );
  }
}

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"): string {
  const value = process.env[name];
  if (!value) throw new MissingSupabaseConfigError(name);
  return value;
}

/**
 * Cliente de Supabase atado a las cookies de la request actual (patrón
 * oficial de `@supabase/ssr` para Next.js App Router — ADR-017, docs/00).
 * Construcción perezosa: no se llama en import-time, así que `next build`
 * no falla sin credenciales reales todavía configuradas.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Un Server Component no puede escribir cookies — el middleware
          // ya se encarga de refrescar la sesión en cada request.
        }
      },
    },
  });
}
