"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildPreferencesUseCases } from "./composition";

const PERSONALITY_KEY = "personality";
const TTS_VOICE_KEY = "ttsVoice";

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

/** Voz de Gemini TTS (ADR-042) — mismo patrón que updatePersonalityAction. */
export async function updateVoiceAction(formData: FormData) {
  const voice = String(formData.get("voice") ?? "").trim();

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  const { setPreference, removePreference } = await buildPreferencesUseCases();
  if (voice) {
    await setPreference.execute(user.userId, TTS_VOICE_KEY, voice);
  } else {
    await removePreference.execute(user.userId, TTS_VOICE_KEY);
  }
  redirect("/configuracion?updated=1");
}
