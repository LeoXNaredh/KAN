import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAiTtsProvider } from "./OpenAiTtsProvider";

describe("OpenAiTtsProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function fakeAudioResponse(overrides: Partial<Response> = {}) {
    return {
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("fake-mp3-bytes").buffer,
      ...overrides,
    };
  }

  it("lanza si falta la API key", () => {
    expect(() => new OpenAiTtsProvider({ apiKey: "" })).toThrow(/falta la API key/);
  });

  it("synthesize() manda el texto, modelo y voz, devuelve un Blob de audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeAudioResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiTtsProvider({ apiKey: "test-key" });
    const blob = await provider.synthesize("hola, esto es una prueba");

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/mpeg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "onyx",
      input: "hola, esto es una prueba",
      response_format: "mp3",
    });
  });

  it("usa modelo y voz custom si se especifican", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeAudioResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiTtsProvider({ apiKey: "test-key", model: "tts-1", voice: "nova" });
    await provider.synthesize("hola");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("tts-1");
    expect(body.voice).toBe("nova");
  });

  it("trunca el texto a 4096 caracteres antes de mandarlo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeAudioResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiTtsProvider({ apiKey: "test-key" });
    const longText = "a".repeat(5000);
    await provider.synthesize(longText);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toHaveLength(4096);
    expect(body.input).toBe("a".repeat(4096));
  });

  it("lanza con el status y el cuerpo si OpenAI responde con error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "API key inválida",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiTtsProvider({ apiKey: "test-key" });

    await expect(provider.synthesize("hola")).rejects.toThrow(/401.*API key inválida/);
  });
});
