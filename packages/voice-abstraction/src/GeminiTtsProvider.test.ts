import { describe, expect, it, vi, afterEach } from "vitest";
import { GeminiTtsProvider, GEMINI_TTS_VOICES, DEFAULT_VOICE } from "./GeminiTtsProvider";

function fakePcmBase64(byteLength = 8): string {
  return Buffer.alloc(byteLength, 7).toString("base64");
}

function fakeAudioResponse(base64 = fakePcmBase64()) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: base64 } }] } }],
    }),
  };
}

describe("GeminiTtsProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lanza si falta la API key", () => {
    expect(() => new GeminiTtsProvider({ apiKey: "" })).toThrow(/falta la API key/);
  });

  it("synthesize() manda el texto, modelo, voz por defecto y devuelve un Blob wav", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeAudioResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GeminiTtsProvider({ apiKey: "test-key" });
    const blob = await provider.synthesize("hola, esto es una prueba");

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/wav");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      contents: [{ parts: [{ text: "hola, esto es una prueba" }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: DEFAULT_VOICE } } },
      },
    });
  });

  it("usa modelo y voz custom si se especifican", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeAudioResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GeminiTtsProvider({ apiKey: "test-key", model: "gemini-3.1-flash-tts-preview", voice: "Kore" });
    await provider.synthesize("hola");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent");
  });

  it("envuelve el PCM base64 en un header WAV válido (RIFF/WAVE, 44 bytes + payload)", async () => {
    const pcmBytes = 16;
    const fetchMock = vi.fn().mockResolvedValue(fakeAudioResponse(fakePcmBase64(pcmBytes)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GeminiTtsProvider({ apiKey: "test-key" });
    const blob = await provider.synthesize("hola");
    const buffer = Buffer.from(await blob.arrayBuffer());

    expect(buffer.length).toBe(44 + pcmBytes);
    expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
    expect(buffer.toString("ascii", 12, 16)).toBe("fmt ");
    expect(buffer.readUInt16LE(20)).toBe(1); // PCM lineal
    expect(buffer.readUInt16LE(22)).toBe(1); // mono
    expect(buffer.readUInt32LE(24)).toBe(24000); // sample rate
    expect(buffer.readUInt16LE(34)).toBe(16); // bits per sample
    expect(buffer.toString("ascii", 36, 40)).toBe("data");
    expect(buffer.readUInt32LE(40)).toBe(pcmBytes);
  });

  it("lanza con el status y el cuerpo si Gemini responde con error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "API key inválida",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GeminiTtsProvider({ apiKey: "test-key" });

    await expect(provider.synthesize("hola")).rejects.toThrow(/401.*API key inválida/);
  });

  it("lanza si la respuesta no trae audio (inlineData ausente)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "no debería venir texto" }] } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GeminiTtsProvider({ apiKey: "test-key" });

    await expect(provider.synthesize("hola")).rejects.toThrow(/no devolvió audio/);
  });

  it("GEMINI_TTS_VOICES tiene las 30 voces documentadas, sin duplicados", () => {
    expect(GEMINI_TTS_VOICES).toHaveLength(30);
    expect(new Set(GEMINI_TTS_VOICES.map((v) => v.name)).size).toBe(30);
    expect(GEMINI_TTS_VOICES.map((v) => v.name)).toContain(DEFAULT_VOICE);
  });
});
