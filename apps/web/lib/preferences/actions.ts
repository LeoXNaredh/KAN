"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildPreferencesUseCases } from "./composition";

const PERSONALITY_KEY = "personality";

export async function updatePersonalityAction(formData: FormData) {
  const personality = String(formData.get("personality") ?? "").trim();

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  const { setPreference, removePreference } = await buildPreferencesUseCases();
  if (personality) {
    await setPreference.execute(user.userId, PERSONALITY_KEY, personality);
  } else {
    await removePreference.execute(user.userId, PERSONALITY_KEY);
  }
  redirect("/configuracion?updated=1");
}
