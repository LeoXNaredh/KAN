import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "@kan/plugin-contract";
import type { PairingPort } from "@kan/core";
import { WsConnectionManager } from "./WsConnectionManager";
import type { AgentConnectionInfo } from "../domain/ports/ConnectionManagerPort";

const TOKEN = "test-token";

function hello(edgeAgentId: string, protocolVersion = PROTOCOL_VERSION, pairingToken?: string) {
  return JSON.stringify({
    type: "hello",
    protocolVersion,
    edgeAgentId,
    installedPlugins: [],
    capabilities: [],
    pairingToken,
  });
}

function fakePairingPort(resolveOwner: PairingPort["resolveOwner"]): PairingPort {
  return {
    generateCode: async () => ({ code: "", expiresAt: "" }),
    claim: async () => undefined,
    resolveOwner,
    getPluginConfig: async () => undefined,
  };
}

function waitFor<T>(fn: (resolve: (value: T) => void) => void, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout esperando evento")), timeoutMs);
    fn((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

describe("WsConnectionManager (integración WS real)", () => {
  let httpServer: Server;
  let manager: WsConnectionManager;
  let port: number;

  beforeEach(async () => {
    manager = new WsConnectionManager(TOKEN);
    manager.start();
    httpServer = createServer();
    httpServer.on("upgrade", (request, socket, head) => {
      if (request.url === "/edge") {
        manager.handleUpgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    manager.stop();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(token = TOKEN): WebSocket {
    return new WebSocket(`ws://localhost:${port}/edge`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it("rechaza la conexión con un token inválido (401, no upgrade)", async () => {
    const ws = connect("token-incorrecto");
    const closeOrError = await new Promise<string>((resolve) => {
      ws.once("unexpected-response", (_req, res) => resolve(`status:${res.statusCode}`));
      ws.once("error", () => resolve("error"));
    });
    expect(closeOrError).toContain("401");
  });

  it("acepta la conexión y confirma el agente tras un hello válido", async () => {
    const ws = connect();
    await waitForOpen(ws);

    const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
    ws.send(hello("agent-abc"));

    const info = await connectedPromise;
    expect(info.edgeAgentId).toBe("agent-abc");
    expect(manager.getState("agent-abc")).toBe("connected");

    ws.close();
  });

  it("rechaza un hello con versión de protocolo mayor incompatible", async () => {
    const ws = connect();
    await waitForOpen(ws);

    const closePromise = waitForClose(ws);
    ws.send(hello("agent-abc", "99.0.0"));

    const { code } = await closePromise;
    expect(code).toBe(4001);
  });

  it("rechaza un segundo 'hello' en la misma conexión (hallazgo A4 de docs/13)", async () => {
    const ws = connect();
    await waitForOpen(ws);
    const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
    ws.send(hello("agent-abc"));
    await connectedPromise;

    const closePromise = waitForClose(ws);
    ws.send(hello("agent-abc"));

    const { code } = await closePromise;
    expect(code).toBe(4003);
  });

  it("una segunda conexión que reclama el mismo edgeAgentId reemplaza (cierra) a la anterior, sin dejar zombies (hallazgo A4 de docs/13)", async () => {
    const wsOld = connect();
    await waitForOpen(wsOld);
    const firstConnectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
    wsOld.send(hello("agent-dup"));
    await firstConnectedPromise;

    const oldClosePromise = waitForClose(wsOld);

    const wsNew = connect();
    await waitForOpen(wsNew);
    const secondConnectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
    wsNew.send(hello("agent-dup"));
    await secondConnectedPromise;

    const { code } = await oldClosePromise;
    expect(code).toBe(4004);
    expect(manager.getState("agent-dup")).toBe("connected");

    wsNew.close();
  });

  it("desconectar el socket dispara onAgentDisconnected y limpia el estado", async () => {
    const ws = connect();
    await waitForOpen(ws);
    const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
    ws.send(hello("agent-xyz"));
    await connectedPromise;

    const disconnectedPromise = waitFor<string>((resolve) => manager.onAgentDisconnected(resolve));
    ws.close();

    const edgeAgentId = await disconnectedPromise;
    expect(edgeAgentId).toBe("agent-xyz");
    expect(manager.getState("agent-xyz")).toBe("disconnected");
  });

  it("send() a un agente sin conexión viva devuelve false sin lanzar", () => {
    expect(manager.send("no-conectado", { type: "agent_task.dispatch", taskId: "t1", deviceId: "d1", capability: "c1", severity: "read-only", requiresConfirmation: false, payload: {}, issuedAt: new Date().toISOString() })).toBe(false);
  });

  it("un unsubscribe de onAgentConnected() detiene la entrega de eventos futuros", async () => {
    let callCount = 0;
    const unsubscribe = manager.onAgentConnected(() => {
      callCount += 1;
    });
    unsubscribe();

    const ws = connect();
    await waitForOpen(ws);
    ws.send(hello("agent-unsub"));
    await new Promise((r) => setTimeout(r, 100));

    expect(callCount).toBe(0);
    ws.close();
  });

  it("rechaza una conexión adicional una vez alcanzado el cap global de conexiones (docs/16 P6, ADR-025)", async () => {
    const cappedManager = new WsConnectionManager(TOKEN, 1);
    cappedManager.start();
    const cappedServer = createServer();
    cappedServer.on("upgrade", (request, socket, head) => {
      if (request.url === "/edge") {
        cappedManager.handleUpgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    });
    await new Promise<void>((resolve) => cappedServer.listen(0, resolve));
    const cappedPort = (cappedServer.address() as { port: number }).port;

    try {
      const first = new WebSocket(`ws://localhost:${cappedPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      await waitForOpen(first);

      const second = new WebSocket(`ws://localhost:${cappedPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const closeOrError = await new Promise<string>((resolve) => {
        second.once("unexpected-response", (_req, res) => resolve(`status:${res.statusCode}`));
        second.once("error", () => resolve("error"));
      });
      expect(closeOrError).toContain("503");

      first.close();
    } finally {
      cappedManager.stop();
      await new Promise<void>((resolve) => cappedServer.close(() => resolve()));
    }
  });

  it("un hello con pairingToken válido resuelve el ownerId (docs/19 P2, incremento 3)", async () => {
    const pairingManager = new WsConnectionManager(
      TOKEN,
      undefined,
      fakePairingPort(async (secret, edgeAgentId) => (secret === "secreto-valido" && edgeAgentId === "agent-paired" ? "user-1" : undefined)),
    );
    pairingManager.start();
    const pairingServer = createServer();
    pairingServer.on("upgrade", (request, socket, head) => {
      if (request.url === "/edge") pairingManager.handleUpgrade(request, socket, head);
      else socket.destroy();
    });
    await new Promise<void>((resolve) => pairingServer.listen(0, resolve));
    const pairingPort = (pairingServer.address() as { port: number }).port;

    try {
      const ws = new WebSocket(`ws://localhost:${pairingPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      await waitForOpen(ws);
      const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => pairingManager.onAgentConnected(resolve));
      ws.send(hello("agent-paired", PROTOCOL_VERSION, "secreto-valido"));

      const info = await connectedPromise;
      expect(info.ownerId).toBe("user-1");
      ws.close();
    } finally {
      pairingManager.stop();
      await new Promise<void>((resolve) => pairingServer.close(() => resolve()));
    }
  });

  it("un pairingToken que no resuelve NO rechaza la conexión — sigue conectando sin ownerId", async () => {
    const pairingManager = new WsConnectionManager(TOKEN, undefined, fakePairingPort(async () => undefined));
    pairingManager.start();
    const pairingServer = createServer();
    pairingServer.on("upgrade", (request, socket, head) => {
      if (request.url === "/edge") pairingManager.handleUpgrade(request, socket, head);
      else socket.destroy();
    });
    await new Promise<void>((resolve) => pairingServer.listen(0, resolve));
    const pairingPort = (pairingServer.address() as { port: number }).port;

    try {
      const ws = new WebSocket(`ws://localhost:${pairingPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      await waitForOpen(ws);
      const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => pairingManager.onAgentConnected(resolve));
      ws.send(hello("agent-unresolved", PROTOCOL_VERSION, "secreto-invalido"));

      const info = await connectedPromise;
      expect(info.ownerId).toBeUndefined();
      expect(pairingManager.getState("agent-unresolved")).toBe("connected");
      ws.close();
    } finally {
      pairingManager.stop();
      await new Promise<void>((resolve) => pairingServer.close(() => resolve()));
    }
  });

  it("si resolveOwner() lanza (ej. Supabase caído), la conexión sigue igual, sin ownerId", async () => {
    const pairingManager = new WsConnectionManager(
      TOKEN,
      undefined,
      fakePairingPort(async () => {
        throw new Error("network error");
      }),
    );
    pairingManager.start();
    const pairingServer = createServer();
    pairingServer.on("upgrade", (request, socket, head) => {
      if (request.url === "/edge") pairingManager.handleUpgrade(request, socket, head);
      else socket.destroy();
    });
    await new Promise<void>((resolve) => pairingServer.listen(0, resolve));
    const pairingPort = (pairingServer.address() as { port: number }).port;

    try {
      const ws = new WebSocket(`ws://localhost:${pairingPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      await waitForOpen(ws);
      const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => pairingManager.onAgentConnected(resolve));
      ws.send(hello("agent-error", PROTOCOL_VERSION, "cualquier-secreto"));

      const info = await connectedPromise;
      expect(info.ownerId).toBeUndefined();
      ws.close();
    } finally {
      pairingManager.stop();
      await new Promise<void>((resolve) => pairingServer.close(() => resolve()));
    }
  });

  it("sin pairingToken en el hello, no se llama a resolveOwner() y el agente conecta sin ownerId (retrocompatible)", async () => {
    let called = false;
    const pairingManager = new WsConnectionManager(
      TOKEN,
      undefined,
      fakePairingPort(async () => {
        called = true;
        return "user-1";
      }),
    );
    pairingManager.start();
    const pairingServer = createServer();
    pairingServer.on("upgrade", (request, socket, head) => {
      if (request.url === "/edge") pairingManager.handleUpgrade(request, socket, head);
      else socket.destroy();
    });
    await new Promise<void>((resolve) => pairingServer.listen(0, resolve));
    const pairingPort = (pairingServer.address() as { port: number }).port;

    try {
      const ws = new WebSocket(`ws://localhost:${pairingPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } });
      await waitForOpen(ws);
      const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => pairingManager.onAgentConnected(resolve));
      ws.send(hello("agent-no-token"));

      const info = await connectedPromise;
      expect(info.ownerId).toBeUndefined();
      expect(called).toBe(false);
      ws.close();
    } finally {
      pairingManager.stop();
      await new Promise<void>((resolve) => pairingServer.close(() => resolve()));
    }
  });

  it("mensajes con forma inesperada (sin 'type' string) se ignoran sin tumbar la conexión (hallazgo M5 de docs/13)", async () => {
    const ws = connect();
    await waitForOpen(ws);
    const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
    ws.send(hello("agent-shape"));
    await connectedPromise;

    ws.send(JSON.stringify({ notAType: true }));
    await new Promise((r) => setTimeout(r, 50));

    // Sigue conectado — no se cerró por el mensaje malformado.
    expect(manager.getState("agent-shape")).toBe("connected");
    ws.close();
  });

  describe("rate limiting por mensaje (fix de auditoría de backend #7)", () => {
    async function buildLimitedManager(maxMessagesPerSecond: number) {
      const limitedManager = new WsConnectionManager(TOKEN, undefined, undefined, maxMessagesPerSecond);
      limitedManager.start();
      const limitedServer = createServer();
      limitedServer.on("upgrade", (request, socket, head) => {
        if (request.url === "/edge") limitedManager.handleUpgrade(request, socket, head);
        else socket.destroy();
      });
      await new Promise<void>((resolve) => limitedServer.listen(0, resolve));
      const limitedPort = (limitedServer.address() as { port: number }).port;
      return {
        manager: limitedManager,
        connect: () => new WebSocket(`ws://localhost:${limitedPort}/edge`, { headers: { authorization: `Bearer ${TOKEN}` } }),
        cleanup: async () => {
          limitedManager.stop();
          await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
        },
      };
    }

    it("por encima de maxMessagesPerSecond, los mensajes de más se ignoran dentro de la misma ventana — la conexión sigue viva", async () => {
      const { manager: limitedManager, connect: connectLimited, cleanup } = await buildLimitedManager(3);
      let ws: WebSocket | undefined;
      try {
        ws = connectLimited();
        await waitForOpen(ws);
        const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => limitedManager.onAgentConnected(resolve));
        // El "hello" también cuenta contra el límite (es un mensaje más) —
        // con max=3, deja lugar para 2 heartbeats más en esta ventana antes
        // de que el resto se empiece a ignorar.
        ws.send(hello("agent-rate-limited"));
        await connectedPromise;

        const received: unknown[] = [];
        limitedManager.onMessage((_edgeAgentId, message) => received.push(message));
        for (let i = 0; i < 5; i++) {
          ws.send(JSON.stringify({ type: "heartbeat", at: String(i) }));
        }
        await new Promise((r) => setTimeout(r, 100));

        expect(received).toHaveLength(2);
        // No se cerró la conexión por superar el límite — mismo criterio que un mensaje malformado (hallazgo M5).
        expect(limitedManager.getState("agent-rate-limited")).toBe("connected");
      } finally {
        ws?.close();
        await cleanup();
      }
    });

    it("tras pasar la ventana de 1s, vuelve a aceptar mensajes normalmente", async () => {
      // max=2: el "hello" ya ocupa 1 de los 2 mensajes de la primera
      // ventana, dejando lugar para exactamente un heartbeat más antes de
      // que el resto se empiece a ignorar.
      const { manager: limitedManager, connect: connectLimited, cleanup } = await buildLimitedManager(2);
      let ws: WebSocket | undefined;
      try {
        ws = connectLimited();
        await waitForOpen(ws);
        const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => limitedManager.onAgentConnected(resolve));
        ws.send(hello("agent-rate-window"));
        await connectedPromise;

        const received: unknown[] = [];
        limitedManager.onMessage((_edgeAgentId, message) => received.push(message));
        ws.send(JSON.stringify({ type: "heartbeat", at: "primero" }));
        ws.send(JSON.stringify({ type: "heartbeat", at: "descartado-misma-ventana" }));
        await new Promise((r) => setTimeout(r, 1100));
        ws.send(JSON.stringify({ type: "heartbeat", at: "segunda-ventana" }));
        await new Promise((r) => setTimeout(r, 50));

        expect(received).toHaveLength(2);
        expect((received[0] as { at: string }).at).toBe("primero");
        expect((received[1] as { at: string }).at).toBe("segunda-ventana");
      } finally {
        ws?.close();
        await cleanup();
      }
    });

    it("sin pasar maxMessagesPerSecond, usa el default (100/seg) — una ráfaga chica no se ve afectada", async () => {
      const ws = connect();
      await waitForOpen(ws);
      const connectedPromise = waitFor<AgentConnectionInfo>((resolve) => manager.onAgentConnected(resolve));
      ws.send(hello("agent-default-rate"));
      await connectedPromise;

      const received: unknown[] = [];
      manager.onMessage((_edgeAgentId, message) => received.push(message));
      for (let i = 0; i < 10; i++) {
        ws.send(JSON.stringify({ type: "heartbeat", at: String(i) }));
      }
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toHaveLength(10);
      ws.close();
    });
  });
});
