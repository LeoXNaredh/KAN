import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { LoggerPort } from "@kan/plugin-contract";
import { GeminiLiveProxy } from "./GeminiLiveProxy";
import { LiveVoiceSessionStore, type LiveVoiceSessionConfig } from "../application/LiveVoiceSessionStore";

const CONFIG: LiveVoiceSessionConfig = {
  model: "gemini-3.1-flash-live-preview",
  systemPrompt: "sé breve, es una prueba",
  tools: [{ name: "read_sensor", description: "lee un sensor", inputSchema: { type: "object", properties: {} } }],
};

const CONFIG_WITH_USER: LiveVoiceSessionConfig = { ...CONFIG, userId: "user-1" };

function fakeLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout esperando mensaje")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

describe("GeminiLiveProxy (integración WS real — Gateway<->fake-Gemini)", () => {
  let fakeGeminiServer: Server;
  let fakeGeminiWss: WebSocketServer;
  let fakeGeminiReceived: Array<{ raw: string; socket: WebSocket }>;
  let gatewayServer: Server;
  let store: LiveVoiceSessionStore;
  let proxy: GeminiLiveProxy;
  let gatewayPort: number;

  beforeEach(async () => {
    // "Gemini" simulado: acepta cualquier conexión, contesta setupComplete
    // al primer mensaje (el 'setup'), y por lo demás solo registra lo que
    // recibe — no necesita saber el protocolo real más allá de eso.
    fakeGeminiReceived = [];
    fakeGeminiServer = createServer();
    fakeGeminiWss = new WebSocketServer({ server: fakeGeminiServer });
    fakeGeminiWss.on("connection", (socket) => {
      let first = true;
      socket.on("message", (raw) => {
        fakeGeminiReceived.push({ raw: raw.toString(), socket });
        if (first) {
          first = false;
          socket.send(JSON.stringify({ setupComplete: {} }));
        }
      });
    });
    await new Promise<void>((resolve) => fakeGeminiServer.listen(0, resolve));
    const geminiPort = (fakeGeminiServer.address() as { port: number }).port;

    store = new LiveVoiceSessionStore();
    proxy = new GeminiLiveProxy(store, "fake-api-key", fakeLogger(), `ws://localhost:${geminiPort}`);

    gatewayServer = createServer();
    gatewayServer.on("upgrade", (request, socket, head) => {
      if (new URL(request.url ?? "/", "http://internal").pathname === "/live-voice") {
        proxy.handleUpgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    });
    await new Promise<void>((resolve) => gatewayServer.listen(0, resolve));
    gatewayPort = (gatewayServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => fakeGeminiWss.close(() => resolve()));
    await new Promise<void>((resolve) => fakeGeminiServer.close(() => resolve()));
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  });

  function connect(sessionId: string): WebSocket {
    return new WebSocket(`ws://localhost:${gatewayPort}/live-voice?sessionId=${sessionId}`);
  }

  it("rechaza el upgrade sin sessionId (401, nunca abre el WS)", async () => {
    const ws = new WebSocket(`ws://localhost:${gatewayPort}/live-voice`);
    const status = await new Promise<number>((resolve) => {
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(401);
  });

  it("rechaza el upgrade con un sessionId que no existe", async () => {
    const ws = connect("no-existe");
    const status = await new Promise<number>((resolve) => {
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(401);
  });

  it("acepta la conexión con un sessionId válido, manda el setup a Gemini, y relaya setupComplete al browser", async () => {
    const { sessionId } = store.register(CONFIG);
    const ws = connect(sessionId);
    await waitForOpen(ws);

    const relayed = await waitForMessage(ws);
    expect(JSON.parse(relayed)).toEqual({ setupComplete: {} });

    expect(fakeGeminiReceived).toHaveLength(1);
    const setupSent = JSON.parse(fakeGeminiReceived[0].raw);
    expect(setupSent.setup.model).toBe("models/gemini-3.1-flash-live-preview");
    expect(setupSent.setup.systemInstruction).toEqual({ parts: [{ text: "sé breve, es una prueba" }] });
    expect(setupSent.setup.tools).toEqual([
      { functionDeclarations: [{ name: "read_sensor", description: "lee un sensor", parametersJsonSchema: CONFIG.tools[0].inputSchema }] },
    ]);

    ws.close();
  });

  it("el setup manda speechConfig con la voz default (ADR-060) cuando no se configuró una explícita", async () => {
    const { sessionId } = store.register(CONFIG);
    const ws = connect(sessionId);
    await waitForOpen(ws);
    await waitForMessage(ws);

    const setupSent = JSON.parse(fakeGeminiReceived[0].raw);
    expect(setupSent.setup.generationConfig.speechConfig).toEqual({
      voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
    });

    ws.close();
  });

  it("una voz custom pasada al constructor reemplaza el default", async () => {
    const geminiPort = (fakeGeminiServer.address() as { port: number }).port;
    const customProxy = new GeminiLiveProxy(store, "fake-api-key", fakeLogger(), `ws://localhost:${geminiPort}`, "Puck");

    // Servidor propio para esta prueba, wireado al proxy con voz custom —
    // el `gatewayServer`/`proxy` de beforeEach usan la voz default.
    const customServer = createServer();
    customServer.on("upgrade", (request, socket, head) => {
      if (new URL(request.url ?? "/", "http://internal").pathname === "/live-voice") {
        customProxy.handleUpgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    });
    await new Promise<void>((resolve) => customServer.listen(0, resolve));
    const customPort = (customServer.address() as { port: number }).port;

    try {
      const { sessionId } = store.register(CONFIG);
      const ws = new WebSocket(`ws://localhost:${customPort}/live-voice?sessionId=${sessionId}`);
      await waitForOpen(ws);
      await waitForMessage(ws);

      const setupSent = JSON.parse(fakeGeminiReceived[0].raw);
      expect(setupSent.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
      ws.close();
    } finally {
      await new Promise<void>((resolve) => customServer.close(() => resolve()));
    }
  });

  it("el sessionId es de un solo uso — una segunda conexión con el mismo id se rechaza", async () => {
    const { sessionId } = store.register(CONFIG);
    const first = connect(sessionId);
    await waitForOpen(first);
    first.close();

    const second = connect(sessionId);
    const status = await new Promise<number>((resolve) => {
      second.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(401);
  });

  it("relaya mensajes del browser hacia Gemini después del setup", async () => {
    const { sessionId } = store.register(CONFIG);
    const ws = connect(sessionId);
    await waitForOpen(ws);
    await waitForMessage(ws); // setupComplete

    ws.send(JSON.stringify({ realtimeInput: { audio: { data: "AAAA", mimeType: "audio/pcm;rate=16000" } } }));
    await vi.waitFor(() => expect(fakeGeminiReceived).toHaveLength(2));

    expect(JSON.parse(fakeGeminiReceived[1].raw)).toEqual({
      realtimeInput: { audio: { data: "AAAA", mimeType: "audio/pcm;rate=16000" } },
    });
    ws.close();
  });

  it("relaya mensajes de Gemini hacia el browser sin interpretarlos (ej. un toolCall)", async () => {
    const { sessionId } = store.register(CONFIG);
    const ws = connect(sessionId);
    await waitForOpen(ws);
    await waitForMessage(ws); // setupComplete

    const toolCall = { toolCall: { functionCalls: [{ id: "call_1", name: "read_sensor", args: {} }] } };
    fakeGeminiReceived[0].socket.send(JSON.stringify(toolCall));

    const relayed = await waitForMessage(ws);
    expect(JSON.parse(relayed)).toEqual(toolCall);
    ws.close();
  });

  it("cerrar la conexión del browser cierra también la conexión con Gemini", async () => {
    const { sessionId } = store.register(CONFIG);
    const ws = connect(sessionId);
    await waitForOpen(ws);
    await waitForMessage(ws); // setupComplete

    const geminiSocket = fakeGeminiReceived[0].socket;
    const geminiClosed = new Promise<void>((resolve) => geminiSocket.once("close", () => resolve()));
    ws.close();

    await geminiClosed;
  });

  describe("speak() — sistema básico de alertas", () => {
    it("devuelve false si el usuario no tiene ninguna sesión Live activa", () => {
      expect(proxy.speak("nadie-conectado", "mensaje")).toBe(false);
    });

    it("con Gemini idle (sin turno en curso), manda el turno sintético ya mismo", async () => {
      const { sessionId } = store.register(CONFIG_WITH_USER);
      const ws = connect(sessionId);
      await waitForOpen(ws);
      await waitForMessage(ws); // setupComplete

      const sent = proxy.speak("user-1", "La temperatura llegó a 43 grados, superó el límite que definiste de 40.");
      expect(sent).toBe(true);

      await vi.waitFor(() => expect(fakeGeminiReceived).toHaveLength(2));
      const alertTurn = JSON.parse(fakeGeminiReceived[1].raw);
      expect(alertTurn.clientContent.turnComplete).toBe(true);
      expect(alertTurn.clientContent.turns[0].role).toBe("user");
      expect(alertTurn.clientContent.turns[0].parts[0].text).toContain(
        "La temperatura llegó a 43 grados, superó el límite que definiste de 40.",
      );

      ws.close();
    });

    it("con Gemini en medio de un turno, encola el aviso y no lo manda todavía", async () => {
      const { sessionId } = store.register(CONFIG_WITH_USER);
      const ws = connect(sessionId);
      await waitForOpen(ws);
      await waitForMessage(ws); // setupComplete

      // Gemini empieza a responder (turno en curso, sin turnComplete todavía).
      fakeGeminiReceived[0].socket.send(
        JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } } }),
      );
      await waitForMessage(ws); // relay del chunk al browser

      const sent = proxy.speak("user-1", "aviso encolado");
      expect(sent).toBe(true);

      // Nada nuevo llegó a "Gemini" todavía — sigue encolado.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fakeGeminiReceived).toHaveLength(1);

      ws.close();
    });

    it("al llegar turnComplete, manda el aviso que estaba encolado", async () => {
      const { sessionId } = store.register(CONFIG_WITH_USER);
      const ws = connect(sessionId);
      await waitForOpen(ws);
      await waitForMessage(ws); // setupComplete

      fakeGeminiReceived[0].socket.send(
        JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } } }),
      );
      await waitForMessage(ws);

      proxy.speak("user-1", "aviso encolado");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fakeGeminiReceived).toHaveLength(1); // todavía encolado

      fakeGeminiReceived[0].socket.send(JSON.stringify({ serverContent: { turnComplete: true } }));

      await vi.waitFor(() => expect(fakeGeminiReceived).toHaveLength(2));
      expect(JSON.parse(fakeGeminiReceived[1].raw).clientContent.turns[0].parts[0].text).toContain("aviso encolado");

      ws.close();
    });

    it("varios avisos encolados se mandan de a uno, esperando el turnComplete de cada uno antes del siguiente", async () => {
      const { sessionId } = store.register(CONFIG_WITH_USER);
      const ws = connect(sessionId);
      await waitForOpen(ws);
      await waitForMessage(ws); // setupComplete

      fakeGeminiReceived[0].socket.send(
        JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } } }),
      );
      await waitForMessage(ws);

      proxy.speak("user-1", "aviso 1");
      proxy.speak("user-1", "aviso 2");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fakeGeminiReceived).toHaveLength(1); // ambos encolados, ninguno mandado todavía

      // Termina el turno actual -> sale el primer aviso encolado (arranca un turno nuevo).
      fakeGeminiReceived[0].socket.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      await vi.waitFor(() => expect(fakeGeminiReceived).toHaveLength(2));
      expect(JSON.parse(fakeGeminiReceived[1].raw).clientContent.turns[0].parts[0].text).toContain("aviso 1");

      // El aviso 1 en sí es un turno — hasta que no termine, el aviso 2 sigue encolado.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fakeGeminiReceived).toHaveLength(2);

      fakeGeminiReceived[0].socket.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      await vi.waitFor(() => expect(fakeGeminiReceived).toHaveLength(3));
      expect(JSON.parse(fakeGeminiReceived[2].raw).clientContent.turns[0].parts[0].text).toContain("aviso 2");

      ws.close();
    });
  });
});
