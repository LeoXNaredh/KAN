import { TranscribeAudioUseCase, SynthesizeSpeechUseCase } from "@kan/core";
import { GroqVoiceProvider, OpenAiTtsProvider } from "@kan/voice-abstraction";

export class MissingGroqConfigError extends Error {
  constructor() {
    super(
      "Falta GROQ_API_KEY. Copia apps/web/.env.example a apps/web/.env.local y agrega tu API key gratuita de Groq (https://console.groq.com/keys).",
    );
  }
}

export class MissingOpenAiConfigError extends Error {
  constructor() {
    super(
      "Falta OPENAI_API_KEY. Copia apps/web/.env.example a apps/web/.env.local y agrega tu API key de OpenAI (https://platform.openai.com/api-keys).",
    );
  }
}

/** Composition root de voz (P1) — mismo patrón que lib/auth/composition.ts. */
export function buildTranscribeAudioUseCase(): TranscribeAudioUseCase {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new MissingGroqConfigError();
  return new TranscribeAudioUseCase(new GroqVoiceProvider({ apiKey }));
}

/** Composition root de TTS (ADR-034) — mismo patrón que buildTranscribeAudioUseCase. */
export function buildSynthesizeSpeechUseCase(): SynthesizeSpeechUseCase {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MissingOpenAiConfigError();
  return new SynthesizeSpeechUseCase(new OpenAiTtsProvider({ apiKey }));
}
