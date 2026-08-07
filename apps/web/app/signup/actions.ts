"use server";

import { redirect } from "next/navigation";
import { buildAuthUseCases } from "@/lib/auth/composition";

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { registerUser } = await buildAuthUseCases();
  try {
    await registerUser.execute({ email, password });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    redirect(`/signup?error=${encodeURIComponent(message)}`);
  }
  redirect("/login?registered=1");
}
