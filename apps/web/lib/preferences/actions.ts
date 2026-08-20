"use server";

import { redirect } from "next/navigation";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildPreferencesUseCases } from "./composition";

const PERSONALITY_KEY = "personality";
const TTS_VOICE_KEY = "ttsVoice";
const DAILY_REPORT_ENABLED_KEY = "dailyReportEnabled";
const DAILY_REPORT_HOUR_KEY = "dailyReportHour";

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

/**
 * Reporte diario por email (DailyReportService, Gateway) — mismo patrón
 * que updatePersonalityAction/updateVoiceAction, dos preferencias a la vez
 * (enabled + hour) en vez de una. Hora en UTC (checkbox de un `<input
 * type="checkbox">` llega como "on" solo si está tildado, ausente si no).
 */
export async function updateDailyReportAction(formData: FormData) {
  const enabled = formData.get("dailyReportEnabled") === "on";
  const hour = Number(formData.get("dailyReportHour") ?? 9);

  const user = await getCurrentUserCached();
  if (!user) redirect("/login");

  const { setPreference } = await buildPreferencesUseCases();
  await setPreference.execute(user.userId, DAILY_REPORT_ENABLED_KEY, enabled);
  await setPreference.execute(user.userId, DAILY_REPORT_HOUR_KEY, hour);
  redirect("/configuracion?updated=1");
}
