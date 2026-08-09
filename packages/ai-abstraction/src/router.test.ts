import { describe, expect, it, vi, afterEach } from "vitest";
import type { AIProviderPort, ChatResponse } from "@kan/core";
import { ModelRouter } from "./router";

function fakeProvider(name: string, chat: (request: unknown) => Promise<ChatResponse>): AIProviderPort {
  return { providerName: name, chat: chat as AIProviderPort["chat"] };
}

describe("ModelRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin fallbacks, delega directo al primario", async () => {
    const primary = fakeProvider("gemini", async () => ({ content: "hola" }));
    const router = new ModelRouter(primary);

    const result = await router.chat({ messages: [] });

    expect(result).toEqual({ content: "hola" });
    expect(router.providerName).toBe("gemini");
  });

  it("providerName devuelve el primario antes de la primera request", () => {
    const primary = fakeProvider("gemini", async () => ({ content: "hola" }));
    const router = new ModelRouter(primary, [fakeProvider("anthropic", async () => ({ content: "x" }))]);

    expect(router.providerName).toBe("gemini");
  });

  it("si el primario falla, cae al primer fallback y lo reporta como providerName", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = fakeProvider("gemini", async () => {
      throw new Error("429 rate limit");
    });
    const fallback = fakeProvider("anthropic", async () => ({ content: "respondió Anthropic" }));
    const router = new ModelRouter(primary, [fallback]);

    const result = await router.chat({ messages: [] });

    expect(result).toEqual({ content: "respondió Anthropic" });
    expect(router.providerName).toBe("anthropic");
  });

  it("prueba los fallbacks en orden hasta que uno responda", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = fakeProvider("gemini", async () => {
      throw new Error("caído");
    });
    const fallback1 = fakeProvider("anthropic", async () => {
      throw new Error("sin cuota");
    });
    const fallback2 = fakeProvider("openai", async () => ({ content: "respondió OpenAI" }));
    const router = new ModelRouter(primary, [fallback1, fallback2]);

    const result = await router.chat({ messages: [] });

    expect(result).toEqual({ content: "respondió OpenAI" });
    expect(router.providerName).toBe("openai");
  });

  it("si todos los proveedores fallan, lanza un error que lista cada falla", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = fakeProvider("gemini", async () => {
      throw new Error("429 rate limit");
    });
    const fallback = fakeProvider("anthropic", async () => {
      throw new Error("401 sin API key válida");
    });
    const router = new ModelRouter(primary, [fallback]);

    await expect(router.chat({ messages: [] })).rejects.toThrow(
      /Todos los proveedores de IA fallaron: gemini \(429 rate limit\) \| anthropic \(401 sin API key válida\)/,
    );
  });

  it("no llama a los fallbacks si el primario responde bien", async () => {
    const fallbackFn = vi.fn(async () => ({ content: "no debería llamarse" }));
    const primary = fakeProvider("gemini", async () => ({ content: "ok" }));
    const router = new ModelRouter(primary, [fakeProvider("anthropic", fallbackFn)]);

    await router.chat({ messages: [] });

    expect(fallbackFn).not.toHaveBeenCalled();
  });
});
