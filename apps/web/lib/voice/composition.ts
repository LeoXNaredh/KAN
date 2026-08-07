import { TranscribeAudioUseCase } from "@kan/core";
import { GroqVoiceProvider } from "@kan/voice-abstraction";

export class MissingGroqConfigError extends Error {
  constructor() {
    super(
      "Falta GROQ_API_KEY. Copia apps/web/.env.example a apps/web/.env.local y agrega tu API key gratuita de Groq (https://console.groq.com/keys).",
    );
  }
}

/** Composition root de voz (P1) — mismo patrón que lib/auth/composition.ts. */
export function buildTranscribeAudioUseCase(): TranscribeAudioUseCase {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new MissingGroqConfigError();
  return new TranscribeAudioUseCase(new GroqVoiceProvider({ apiKey }));
}
