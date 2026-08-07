import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { createBroker } from "aedes";
import { NodeMqttTransport } from "./NodeMqttTransport";
import type { MqttConnection, MqttConnectionState } from "../MqttTransportPort";

/**
 * Integración contra un broker MQTT real vía `aedes` (ADR-012, docs/00: los
 * límites de red se prueban con clientes/servidores reales, no con mocks) —
 * mismo criterio que NodeTcpTransport.test.ts.
 */

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
    });
  });
}

function waitForState(connection: MqttConnection, target: MqttConnectionState, timeoutMs = 5000): Promise<void> {
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
    unsubscribe = connection.onStateChange((info) => {
      if (info.state === target) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("NodeMqttTransport (integración contra un broker aedes real)", () => {
  let server: Server | undefined;
  let broker: ReturnType<typeof createBroker> | undefined;
  let acceptedSocket: Socket | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    if (broker) {
      await new Promise<void>((resolve) => broker?.close(() => resolve()));
      broker = undefined;
    }
    acceptedSocket = undefined;
  });

  function startBroker(): Promise<number> {
    broker = createBroker();
    server = createServer((socket: Socket) => {
      acceptedSocket = socket;
      broker?.handle(socket);
    });
    return listen(server);
  }

  it("se conecta a un broker real, publica y recibe", async () => {
    const port = await startBroker();
    const transport = new NodeMqttTransport();
    const connection = await transport.connect(`mqtt://127.0.0.1:${port}`);
    expect(connection.state).toBe("connected");

    let resolveReceived: (payload: string) => void = () => {};
    const received = new Promise<string>((resolve) => {
      resolveReceived = resolve;
    });
    await connection.subscribe("kan/test", (payload) => resolveReceived(payload));
    await connection.publish("kan/test", "hola");

    expect(await received).toBe("hola");
    await connection.close();
  });

  it("rechaza connect() si no hay nada escuchando en el puerto", async () => {
    const transport = new NodeMqttTransport();
    await expect(transport.connect("mqtt://127.0.0.1:1", { connectTimeoutMs: 2000 })).rejects.toThrow();
  }, 10000);

  it("ante una caída, se reconecta solo y vuelve a suscribirse sin que el plugin llame subscribe() de nuevo", async () => {
    const port = await startBroker();
    const transport = new NodeMqttTransport({ reconnectPeriodMs: 50 });
    const connection = await transport.connect(`mqtt://127.0.0.1:${port}`);

    let resolveReceived: (payload: string) => void = () => {};
    const received = new Promise<string>((resolve) => {
      resolveReceived = resolve;
    });
    await connection.subscribe("kan/test", (payload) => resolveReceived(payload));

    acceptedSocket?.destroy(); // simula una caída transitoria de red

    await waitForState(connection, "reconnecting");
    await waitForState(connection, "connected");

    // Publica DESPUÉS de reconectar, sin volver a llamar subscribe(): si el
    // handler original recibe esto, confirma que mqtt.js resuscribió solo
    // (resubscribe: true, ver NodeMqttTransport.ts).
    await connection.publish("kan/test", "post-reconexion");
    expect(await received).toBe("post-reconexion");

    await connection.close();
  }, 10000);

  it("agota los reintentos y pasa a 'disconnected' (evento fatal) si el broker no vuelve", async () => {
    const port = await startBroker();
    const transport = new NodeMqttTransport({ reconnectPeriodMs: 30, maxReconnectAttempts: 2 });
    const connection = await transport.connect(`mqtt://127.0.0.1:${port}`);
    expect(connection.state).toBe("connected");

    // server.close() no dispara su callback hasta que no queden conexiones
    // abiertas — hay que destruir la conexión aceptada primero (mismo
    // cuidado que NodeTcpTransport.test.ts).
    acceptedSocket?.destroy();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;

    await waitForState(connection, "disconnected", 5000);
  }, 10000);

  it("publish() lanza si la conexión no está 'connected', no falla en silencio", async () => {
    const port = await startBroker();
    const transport = new NodeMqttTransport();
    const connection = await transport.connect(`mqtt://127.0.0.1:${port}`);
    await connection.close();

    await expect(connection.publish("kan/test", "x")).rejects.toThrow(/No se puede publicar/);
  });

  it("unsubscribe() de un topic nunca suscrito es idempotente (no lanza)", async () => {
    const port = await startBroker();
    const transport = new NodeMqttTransport();
    const connection = await transport.connect(`mqtt://127.0.0.1:${port}`);

    await expect(connection.unsubscribe("kan/nunca-suscrito")).resolves.toBeUndefined();
    await connection.close();
  });
});
