import { TranscribeAudioUseCase, SynthesizeSpeechUseCase } from "@kan/core";
import { GroqVoiceProvider, OpenAiTtsProvider, GeminiTtsProvider } from "@kan/voice-abstraction";
import { SupabaseUserPreferencesStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TTS_VOICE_PREFERENCE_KEY = "ttsVoice";

export class MissingGroqConfigError extends Error {
  constructor() {
    super(
      "Falta GROQ_API_KEY. Copia apps/web/.env.example a apps/web/.env.local y agrega tu API key gratuita de Groq (https://console.groq.com/keys).",
    );
  }
}

export class MissingVoiceConfigError extends Error {
  constructor() {
    super(
      "Falta GEMINI_API_KEY (o, como alternativa, OPENAI_API_KEY). Copia apps/web/.env.example a apps/web/.env.local y agrega al menos una.",
    );
  }
}

/** Composition root de voz (P1) — mismo patrón que lib/auth/composition.ts. */
export function buildTranscribeAudioUseCase(): TranscribeAudioUseCase {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new MissingGroqConfigError();
  return new TranscribeAudioUseCase(new GroqVoiceProvider({ apiKey }));
}

/**
 * Composition root de TTS (ADR-034, ADR-042): Gemini es el proveedor por
 * defecto (gratis, misma key que ya usa el chat) — OpenAI queda como
 * alternativa solo si configurás `OPENAI_API_KEY` y no hay `GEMINI_API_KEY`.
 * `userId` es opcional (sin sesión, usa la voz default de GeminiTtsProvider)
 * — se relee la preferencia en cada llamada porque esta función se
 * reconstruye de cero en cada request de `/api/voice/synthesize`.
 */
export async function buildSynthesizeSpeechUseCase(userId: string | undefined): Promise<SynthesizeSpeechUseCase> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    const voice = userId ? await resolveVoicePreference(userId) : undefined;
    return new SynthesizeSpeechUseCase(new GeminiTtsProvider({ apiKey: geminiKey, voice }));
  }

  if (openaiKey) {
    return new SynthesizeSpeechUseCase(new OpenAiTtsProvider({ apiKey: openaiKey }));
  }

  throw new MissingVoiceConfigError();
}

async function resolveVoicePreference(userId: string): Promise<string | undefined> {
  try {
    const preferencesStore = new SupabaseUserPreferencesStore(await createSupabaseServerClient());
    const preference = await preferencesStore.get(userId, TTS_VOICE_PREFERENCE_KEY);
    return typeof preference?.value === "string" ? preference.value : undefined;
  } catch {
    // Sin Supabase configurado, o cualquier otro fallo leyendo la
    // preferencia: se sintetiza igual con la voz default (ADR-034 — el
    // chat/voz nunca se rompe por un problema de config/red secundario).
    return undefined;
  }
}
