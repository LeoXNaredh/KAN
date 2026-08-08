import type { VoiceProviderPort } from "@kan/core";

export interface OpenAiTtsProviderConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

// Catálogo de modelos/voces puede cambiar — si esto empieza a fallar,
// revisar https://platform.openai.com/docs/guides/text-to-speech
const DEFAULT_MODEL = "gpt-4o-mini-tts";
// "onyx": voz grave y calma — más cerca del tono "asistente" buscado que la
// default de OpenAI ("alloy", más neutra/brillante).
const DEFAULT_VOICE = "onyx";
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
// Límite duro documentado por OpenAI para /v1/audio/speech — sin este corte,
// una respuesta larga de KAN tira un error 400 en vez de degradar a "se lee
// el principio de la respuesta".
const MAX_INPUT_CHARS = 4096;

/**
 * Adaptador de VoiceProviderPort (solo TTS, ADR-034) sobre la API de OpenAI
 * — fetch directo, sin SDK (mismo criterio que ADR-011 y GroqVoiceProvider).
 */
export class OpenAiTtsProvider implements Pick<VoiceProviderPort, "synthesize"> {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;

  constructor(config: OpenAiTtsProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "OpenAiTtsProvider: falta la API key. Define OPENAI_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.voice = config.voice ?? DEFAULT_VOICE;
  }

  async synthesize(text: string): Promise<Blob> {
    const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

    const response = await fetch(SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, voice: this.voice, input, response_format: "mp3" }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenAI respondió ${response.status} al sintetizar: ${errorBody || response.statusText}`);
    }

    const bytes = await response.arrayBuffer();
    return new Blob([bytes], { type: "audio/mpeg" });
  }
}
