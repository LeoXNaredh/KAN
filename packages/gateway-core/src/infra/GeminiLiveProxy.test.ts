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
});
