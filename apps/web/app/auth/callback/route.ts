import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Intercambia el código del Magic Link (flujo PKCE) por una sesión real.
 * Plomería de transporte pura — no hay decisión de negocio que orquestar
 * vía @kan/core aquí, es completar un redirect que Supabase ya inició.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/inicio`);
}
