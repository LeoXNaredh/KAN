import { describe, expect, it, vi, afterEach } from "vitest";
import { LiveVoiceSessionStore, type LiveVoiceSessionConfig } from "./LiveVoiceSessionStore";

const CONFIG: LiveVoiceSessionConfig = {
  model: "gemini-3.1-flash-live-preview",
  systemPrompt: "sé breve",
  tools: [],
};

describe("LiveVoiceSessionStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("register() + claim() devuelve la config exacta que se registró", () => {
    const store = new LiveVoiceSessionStore();
    const { sessionId } = store.register(CONFIG);

    expect(store.claim(sessionId)).toEqual(CONFIG);
  });

  it("register() devuelve un sessionId y un expiresAt ISO", () => {
    const store = new LiveVoiceSessionStore();
    const registration = store.register(CONFIG);

    expect(typeof registration.sessionId).toBe("string");
    expect(registration.sessionId).not.toBe("");
    expect(new Date(registration.expiresAt).toString()).not.toBe("Invalid Date");
    expect(new Date(registration.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("claim() es de un solo uso — un segundo claim del mismo sessionId devuelve undefined", () => {
    const store = new LiveVoiceSessionStore();
    const { sessionId } = store.register(CONFIG);

    store.claim(sessionId);

    expect(store.claim(sessionId)).toBeUndefined();
  });

  it("claim() de un sessionId inexistente devuelve undefined, no lanza", () => {
    const store = new LiveVoiceSessionStore();
    expect(store.claim("no-existe")).toBeUndefined();
  });

  it("claim() de una sesión vencida devuelve undefined", () => {
    vi.useFakeTimers();
    const store = new LiveVoiceSessionStore(1000);
    const { sessionId } = store.register(CONFIG);

    vi.advanceTimersByTime(1001);

    expect(store.claim(sessionId)).toBeUndefined();
  });

  it("dos sesiones registradas por separado no se pisan", () => {
    const store = new LiveVoiceSessionStore();
    const other: LiveVoiceSessionConfig = { model: "otro-modelo", systemPrompt: "otro", tools: [] };
    const { sessionId: idA } = store.register(CONFIG);
    const { sessionId: idB } = store.register(other);

    expect(store.claim(idA)).toEqual(CONFIG);
    expect(store.claim(idB)).toEqual(other);
  });
});
