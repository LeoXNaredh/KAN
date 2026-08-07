import { describe, expect, it, vi, afterEach } from "vitest";
import { GroqVoiceProvider, extensionFor } from "./GroqVoiceProvider";

describe("GroqVoiceProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lanza si falta la API key", () => {
    expect(() => new GroqVoiceProvider({ apiKey: "" })).toThrow(/falta la API key/);
  });

  it("transcribe() manda el audio y el modelo, devuelve el texto", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "hola, esto es una prueba" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GroqVoiceProvider({ apiKey: "test-key" });
    const audio = { data: new Blob(["fake-audio"], { type: "audio/webm" }), mimeType: "audio/webm" };

    const text = await provider.transcribe(audio);

    expect(text).toBe("hola, esto es una prueba");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("usa el modelo por defecto si no se especifica otro", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GroqVoiceProvider({ apiKey: "test-key" });
    await provider.transcribe({ data: new Blob(["x"]), mimeType: "audio/webm" });

    const formData = fetchMock.mock.calls[0][1].body as FormData;
    expect(formData.get("model")).toBe("whisper-large-v3-turbo");
  });

  it("lanza con el status y el cuerpo si Groq responde con error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "API key inválida",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GroqVoiceProvider({ apiKey: "test-key" });

    await expect(provider.transcribe({ data: new Blob(["x"]), mimeType: "audio/webm" })).rejects.toThrow(
      /401.*API key inválida/,
    );
  });

  it("devuelve string vacío si la respuesta no trae 'text'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GroqVoiceProvider({ apiKey: "test-key" });
    expect(await provider.transcribe({ data: new Blob(["x"]), mimeType: "audio/webm" })).toBe("");
  });
});

describe("extensionFor", () => {
  it("mapea mimetypes comunes a su extensión", () => {
    expect(extensionFor("audio/webm")).toBe("webm");
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/wav")).toBe("wav");
    expect(extensionFor("audio/ogg")).toBe("ogg");
    expect(extensionFor("application/octet-stream")).toBe("bin");
  });
});
