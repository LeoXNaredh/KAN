"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthUseCases } from "@/lib/auth/composition";
import { toHumanMessage } from "@/lib/errors/toHumanMessage";

export async function signInWithPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { signInWithPassword } = await buildAuthUseCases();
  try {
    await signInWithPassword.execute({ email, password });
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(toMessage(error))}`);
  }
  redirect("/inicio");
}

export async function sendMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const origin = (await headers()).get("origin") ?? "";

  const { requestMagicLink } = await buildAuthUseCases();
  try {
    await requestMagicLink.execute(email, `${origin}/auth/callback`);
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(toMessage(error))}`);
  }
  redirect("/login?magicLinkSent=1");
}

function toMessage(error: unknown): string {
  return toHumanMessage(error instanceof Error ? error.message : undefined);
}
