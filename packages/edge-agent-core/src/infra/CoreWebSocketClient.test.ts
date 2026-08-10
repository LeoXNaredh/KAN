import { describe, expect, it, vi, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import type { EdgeToCoreMessage } from "@kan/plugin-contract";
import { CoreWebSocketClient, MAX_QUEUE_SIZE } from "./CoreWebSocketClient";
import { EdgeAgentBus } from "../application/EdgeAgentBus";
import type { LoggerPort } from "../domain/ports/LoggerPort";

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Servidor WS real en loopback (ADR-012: fakes/servidores reales sobre mocks) — hace de Core Cloud fake. */
async function startFakeCoreServer(): Promise<{ port: number; wss: WebSocketServer; received: EdgeToCoreMessage[] }> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const received: EdgeToCoreMessage[] = [];
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      received.push(JSON.parse(raw.toString()) as EdgeToCoreMessage);
    });
  });
  const port = (wss.address() as AddressInfo).port;
  return { port, wss, received };
}

function closeServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => resolve());
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitFor: timeout"));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

describe("CoreWebSocketClient — cola offline (fix de auditoria de backend)", () => {
  const clients: CoreWebSocketClient[] = [];
  const servers: WebSocketServer[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    for (const wss of servers.splice(0)) await closeServer(wss);
  });

  it("send() con el WS caido encola el mensaje en vez de descartarlo", () => {
    const client = new CoreWebSocketClient("ws://127.0.0.1:1", "token", new EdgeAgentBus(), createLogger());
    clients.push(client);

    client.send({ type: "heartbeat", at: "1" });
    client.send({ type: "heartbeat", at: "2" });

    expect(client.queuedMessageCount).toBe(2);
  });

  it("al reconectar, reenvia los mensajes encolados en orden", async () => {
    const { port, wss, received } = await startFakeCoreServer();
    servers.push(wss);

    const client = new CoreWebSocketClient(`ws://127.0.0.1:${port}`, "token", new EdgeAgentBus(), createLogger());
    clients.push(client);

    // Nunca se llamo start(): el WS jamas existio, mismo camino que una
    // caida real (ws?.readyState !== OPEN) sin depender de backoff/tiempo.
    client.send({ type: "audit.local", deviceId: "d1", capability: "cap1", success: true, at: "1" });
    client.send({ type: "audit.local", deviceId: "d1", capability: "cap2", success: true, at: "2" });
    expect(client.queuedMessageCount).toBe(2);

    client.start();
    await waitFor(() => received.length === 2);

    expect(received.map((m) => (m as { capability: string }).capability)).toEqual(["cap1", "cap2"]);
    expect(client.queuedMessageCount).toBe(0);
  });

  it("un mensaje mandado ya conectado no pasa por la cola — se envia directo", async () => {
    const { port, wss, received } = await startFakeCoreServer();
    servers.push(wss);

    const client = new CoreWebSocketClient(`ws://127.0.0.1:${port}`, "token", new EdgeAgentBus(), createLogger());
    clients.push(client);
    client.start();
    await waitFor(() => client.status === "connected");

    client.send({ type: "heartbeat", at: "directo" });
    await waitFor(() => received.length === 1);

    expect(client.queuedMessageCount).toBe(0);
    expect(received[0]).toMatchObject({ type: "heartbeat", at: "directo" });
  });

  it("respeta MAX_QUEUE_SIZE descartando los mensajes mas viejos primero (FIFO)", async () => {
    const client = new CoreWebSocketClient("ws://127.0.0.1:1", "token", new EdgeAgentBus(), createLogger());
    clients.push(client);

    for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
      client.send({ type: "heartbeat", at: String(i) });
    }
    expect(client.queuedMessageCount).toBe(MAX_QUEUE_SIZE);

    const { port, wss, received } = await startFakeCoreServer();
    servers.push(wss);
    // No se puede cambiar la URL de un cliente ya construido — se arma uno
    // nuevo apuntando al servidor real y se lo llena igual, para verificar
    // el recorte sin acoplar el test a reconnect/timers.
    const client2 = new CoreWebSocketClient(`ws://127.0.0.1:${port}`, "token", new EdgeAgentBus(), createLogger());
    clients.push(client2);
    for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
      client2.send({ type: "heartbeat", at: String(i) });
    }
    client2.start();
    await waitFor(() => received.length === MAX_QUEUE_SIZE);

    const ats = received.map((m) => (m as { at: string }).at);
    expect(ats[0]).toBe("5"); // se descartaron los 5 mas viejos (0-4)
    expect(ats[ats.length - 1]).toBe(String(MAX_QUEUE_SIZE + 4));
  });
});
