"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthUseCases } from "./composition";

/**
 * Compartida entre /login y /signup: "continuar con Google" es el mismo
 * flujo entre a la app por primera vez o no — Supabase crea la cuenta sola
 * si no existía (igual que hace el propio botón de Google en su dashboard).
 */
export async function signInWithGoogleAction() {
  const origin = (await headers()).get("origin") ?? "";
  const { requestOAuthSignIn } = await buildAuthUseCases();

  let redirectUrl: string;
  try {
    redirectUrl = await requestOAuthSignIn.execute("google", `${origin}/auth/callback`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }
  redirect(redirectUrl);
}
