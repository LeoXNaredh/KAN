import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { NodeTcpTransport } from "./NodeTcpTransport";
import type { LineConnection, LineConnectionState } from "@kan/serial-line-transport";

/**
 * Integración contra un servidor TCP real (ADR-012, docs/00: los límites de
 * red se prueban con clientes/servidores reales, no con mocks) — mismo
 * criterio que WsConnectionManager.test.ts en gateway-core.
 */

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
    });
  });
}

function waitForState(connection: LineConnection, target: LineConnectionState, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (connection.state === target) {
      resolve();
      return;
    }
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout esperando estado "${target}" — quedó en "${connection.state}"`));
    }, timeoutMs);
    unsubscribe = connection.onStateChange((state) => {
      if (state === target) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("NodeTcpTransport (integración TCP real)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it("se conecta a un servidor real y manda/recibe líneas", async () => {
    server = createServer((socket: Socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const port = await listen(server);

    const transport = new NodeTcpTransport();
    const connection = await transport.open("127.0.0.1", port);
    expect(connection.state).toBe("connected");

    const received = new Promise<string>((resolve) => {
      connection.onLine((line) => resolve(line));
    });
    connection.write("hola");

    expect(await received).toBe("hola");
    await connection.close();
  });

  it("rechaza open() si no hay nada escuchando en el puerto", async () => {
    const transport = new NodeTcpTransport();
    await expect(transport.open("127.0.0.1", 1)).rejects.toThrow();
  });

  it("ante una caída, pasa a 'reconnecting' y vuelve a 'connected' si el servidor sigue escuchando", async () => {
    let acceptedSocket: Socket | undefined;
    server = createServer((socket: Socket) => {
      acceptedSocket = socket;
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const port = await listen(server);

    const transport = new NodeTcpTransport({ baseReconnectDelayMs: 20, maxReconnectAttempts: 3 });
    const connection = await transport.open("127.0.0.1", port);

    acceptedSocket?.destroy(); // simula una caída de WiFi transitoria

    await waitForState(connection, "reconnecting");
    await waitForState(connection, "connected");

    await connection.close();
  }, 10000);

  it("agota los reintentos y pasa a 'disconnected' (evento fatal) si el servidor no vuelve", async () => {
    let acceptedSocket: Socket | undefined;
    server = createServer((socket: Socket) => {
      acceptedSocket = socket;
    });
    const port = await listen(server);

    const transport = new NodeTcpTransport({ baseReconnectDelayMs: 10, maxReconnectAttempts: 2 });
    const connection = await transport.open("127.0.0.1", port);
    expect(connection.state).toBe("connected");

    // server.close() no dispara su callback hasta que no queden conexiones
    // abiertas — hay que destruir la conexión aceptada primero, si no
    // server.close() se queda esperando para siempre.
    acceptedSocket?.destroy();
    await new Promise<void>((resolve) => server?.close(() => resolve()));

    await waitForState(connection, "disconnected");
  }, 10000);

  it("write() lanza si la conexión no está 'connected', no falla en silencio", async () => {
    server = createServer((socket: Socket) => socket.on("data", () => {}));
    const port = await listen(server);

    const transport = new NodeTcpTransport();
    const connection = await transport.open("127.0.0.1", port);
    await connection.close();

    expect(() => connection.write("x")).toThrow(/No se puede escribir/);
  });
});
