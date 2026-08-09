import { WebSocketServer } from "ws";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NodeWsTransport } from "./NodeWsTransport";

/**
 * Contra un WebSocketServer real, no un mock — mismo criterio (ADR-012)
 * que NodeMqttTransport.test.ts contra un broker aedes real, y
 * GeminiLiveProxy.test.ts contra un servidor WS simulado local.
 */
describe("NodeWsTransport (integración contra un servidor WS real)", () => {
  let server: WebSocketServer;
  let url: string;
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    server.on("connection", (socket, request) => {
      lastHeaders = request.headers;
      socket.on("message", (data) => {
        const text = data.toString();
        if (text === "eco") socket.send("eco de vuelta");
        else socket.send(`recibido: ${text}`);
      });
    });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No se pudo levantar el servidor de prueba");
    url = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("connect() real abre la conexión y queda 'connected'", async () => {
    const transport = new NodeWsTransport();
    const connection = await transport.connect(url, () => {});
    expect(connection.state).toBe("connected");
    await connection.close();
  });

  it("connect() manda el header configurado, el servidor lo recibe", async () => {
    const transport = new NodeWsTransport();
    const connection = await transport.connect(url, () => {}, { header: { name: "Authorization", value: "Bearer xyz" } });
    expect(lastHeaders.authorization).toBe("Bearer xyz");
    await connection.close();
  });

  it("send() real y el servidor responde — el mensaje llega por onMessage", async () => {
    const transport = new NodeWsTransport();
    const received: string[] = [];
    const connection = await transport.connect(url, (payload) => received.push(payload));

    await connection.send("eco");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toEqual(["eco de vuelta"]);
    await connection.close();
  });

  it("close() real deja el estado en 'disconnected' y send() posterior falla", async () => {
    const transport = new NodeWsTransport();
    const connection = await transport.connect(url, () => {});
    await connection.close();

    expect(connection.state).toBe("disconnected");
    await expect(connection.send("x")).rejects.toThrow(/disconnected/);
  });

  it("connect() a un puerto sin nada escuchando rechaza, no cuelga", async () => {
    const transport = new NodeWsTransport();
    await expect(transport.connect("ws://127.0.0.1:1", () => {}, { connectTimeoutMs: 500 })).rejects.toThrow();
  });
});
