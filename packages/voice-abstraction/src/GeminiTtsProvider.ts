import type { VoiceProviderPort } from "@kan/core";

export interface GeminiTtsProviderConfig {
  apiKey: string;
  model?: string;
  voice?: string;
}

// Catálogo de modelos TTS de Gemini puede cambiar — si esto empieza a fallar,
// revisar https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
export const DEFAULT_VOICE = "Charon"; // "Informative" — tono asistente, mismo criterio que "onyx" en OpenAI.

function generateContentUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * Las 30 voces prebuilt documentadas por Google, con su adjetivo de estilo
 * — vive acá (no duplicada en apps/web) para que el selector de /configuracion
 * y el default de este provider compartan una sola fuente de verdad.
 */
export const GEMINI_TTS_VOICES: Array<{ name: string; style: string }> = [
  { name: "Zephyr", style: "Bright" },
  { name: "Puck", style: "Upbeat" },
  { name: "Charon", style: "Informative" },
  { name: "Kore", style: "Firm" },
  { name: "Fenrir", style: "Excitable" },
  { name: "Leda", style: "Youthful" },
  { name: "Orus", style: "Firm" },
  { name: "Aoede", style: "Breezy" },
  { name: "Callirrhoe", style: "Easy-going" },
  { name: "Autonoe", style: "Bright" },
  { name: "Enceladus", style: "Breathy" },
  { name: "Iapetus", style: "Clear" },
  { name: "Umbriel", style: "Easy-going" },
  { name: "Algieba", style: "Smooth" },
  { name: "Despina", style: "Smooth" },
  { name: "Erinome", style: "Clear" },
  { name: "Algenib", style: "Gravelly" },
  { name: "Rasalgethi", style: "Informative" },
  { name: "Laomedeia", style: "Upbeat" },
  { name: "Achernar", style: "Soft" },
  { name: "Alnilam", style: "Firm" },
  { name: "Schedar", style: "Even" },
  { name: "Gacrux", style: "Mature" },
  { name: "Pulcherrima", style: "Forward" },
  { name: "Achird", style: "Friendly" },
  { name: "Zubenelgenubi", style: "Casual" },
  { name: "Vindemiatrix", style: "Gentle" },
  { name: "Sadachbia", style: "Lively" },
  { name: "Sadaltager", style: "Knowledgeable" },
  { name: "Sulafat", style: "Warm" },
];

/**
 * Adaptador de VoiceProviderPort (solo TTS) sobre la API de Gemini — mismo
 * criterio que OpenAiTtsProvider: fetch directo, sin SDK (ADR-011), aunque
 * acá reusa el mismo GEMINI_API_KEY que ya usa GeminiProvider para el chat,
 * sin variable de entorno nueva.
 *
 * A diferencia de OpenAI (que devuelve un mp3 listo), Gemini devuelve PCM
 * crudo en base64 (24kHz, mono, 16-bit) dentro de `inlineData.data` — sin
 * header de archivo. `pcmToWav()` le agrega un header WAV mínimo (44 bytes,
 * sin librerías) para que sea un Blob reproducible por un <audio> normal.
 */
export class GeminiTtsProvider implements Pick<VoiceProviderPort, "synthesize"> {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;

  constructor(config: GeminiTtsProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "GeminiTtsProvider: falta la API key. Define GEMINI_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.voice = config.voice ?? DEFAULT_VOICE;
  }

  async synthesize(text: string): Promise<Blob> {
    const response = await fetch(generateContentUrl(this.model), {
      method: "POST",
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Gemini respondió ${response.status} al sintetizar: ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
    };
    const base64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64) {
      throw new Error("Gemini no devolvió audio en la respuesta (candidates[0].content.parts[0].inlineData.data ausente).");
    }

    const pcm = Buffer.from(base64, "base64");
    // Uint8Array "fresco" (no un Buffer de Node): BlobPart exige un
    // ArrayBufferView respaldado por ArrayBuffer, y el tipo de Buffer
    // permite ArrayBufferLike (incluye SharedArrayBuffer) — no compila en
    // consumidores con lib DOM estricta (ej. apps/web) sin esta conversión.
    return new Blob([new Uint8Array(pcmToWav(pcm))], { type: "audio/wav" });
  }
}

/** Header RIFF/WAVE de 44 bytes sobre PCM crudo — mismo formato que devuelve Gemini (24kHz, mono, 16-bit). */
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // tamaño del subchunk fmt
  header.writeUInt16LE(1, 20); // PCM lineal
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
