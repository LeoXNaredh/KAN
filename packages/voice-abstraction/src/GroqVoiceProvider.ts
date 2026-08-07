import type { AudioInput, VoiceProviderPort } from "@kan/core";

export interface GroqVoiceProviderConfig {
  apiKey: string;
  model?: string;
}

// Igual que con Gemini (ai-abstraction), el catálogo de modelos puede
// cambiar — si esto empieza a fallar, revisar https://console.groq.com/docs/models
const DEFAULT_MODEL = "whisper-large-v3-turbo";
const TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Adaptador de VoiceProviderPort (STT únicamente, ADR-014) sobre la API de
 * Groq — compatible con el formato de OpenAI, por eso un `fetch` directo
 * alcanza sin necesidad de un SDK (mismo criterio que ADR-011).
 */
export class GroqVoiceProvider implements VoiceProviderPort {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: GroqVoiceProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "GroqVoiceProvider: falta la API key. Define GROQ_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async transcribe(audio: AudioInput): Promise<string> {
    const formData = new FormData();
    formData.append("file", audio.data, `audio.${extensionFor(audio.mimeType)}`);
    formData.append("model", this.model);

    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Groq respondió ${response.status} al transcribir: ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as { text?: string };
    return data.text ?? "";
  }
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  return "bin";
}
