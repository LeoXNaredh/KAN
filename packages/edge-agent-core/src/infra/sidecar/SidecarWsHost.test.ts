import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import { SIDECAR_PROTOCOL_VERSION, type DiscoverResultMessage } from "@kan/plugin-contract";
import { SidecarWsHost } from "./SidecarWsHost";

const PLUGIN_ID = "kan-plugin-fake";
const TOKEN = "test-token";

function connectClient(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function once(ws: WebSocket, event: "message" | "close"): Promise<unknown> {
  return new Promise((resolve) => ws.once(event, resolve));
}

async function sendHello(ws: WebSocket, overrides: Partial<{ pluginId: string; token: string; protocolVersion: string }> = {}) {
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  ws.send(
    JSON.stringify({
      type: "sidecar_hello",
      protocolVersion: overrides.protocolVersion ?? SIDECAR_PROTOCOL_VERSION,
      pluginId: overrides.pluginId ?? PLUGIN_ID,
      pluginVersion: "0.1.0",
      token: overrides.token ?? TOKEN,
    }),
  );
}

describe("SidecarWsHost", () => {
  it("start() abre un puerto real en loopback", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    expect(port).toBeGreaterThan(0);
    host.close();
  });

  it("acepta un handshake válido y resuelve waitForHello()", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);

    const helloPromise = host.waitForHello(2000);
    await sendHello(client);
    await expect(helloPromise).resolves.toBeUndefined();

    const ack = await once(client, "message");
    expect(JSON.parse(String(ack))).toEqual({ type: "sidecar_hello_ack", ok: true });

    client.close();
    host.close();
  });

  it("rechaza waitForHello() si el token no coincide y cierra el socket", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);

    const helloPromise = host.waitForHello(2000);
    await sendHello(client, { token: "token-equivocado" });

    await expect(helloPromise).rejects.toThrow(/handshake/i);
    await once(client, "close");
    host.close();
  });

  it("rechaza waitForHello() si el pluginId no coincide", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);

    const helloPromise = host.waitForHello(2000);
    await sendHello(client, { pluginId: "otro-plugin" });

    await expect(helloPromise).rejects.toThrow(/handshake/i);
    client.close();
    host.close();
  });

  it("rechaza waitForHello() por timeout si nunca llega el hello", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    await host.start();

    await expect(host.waitForHello(50)).rejects.toThrow(/no se recibió sidecar_hello/i);
    host.close();
  });

  it("rechaza waitForHello() si el socket se cierra antes de mandar hello", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const helloPromise = host.waitForHello(2000);
    client.close();

    await expect(helloPromise).rejects.toThrow(/se cerró antes/i);
    host.close();
  });

  it("request() correlaciona por requestId y devuelve la respuesta", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);
    await sendHello(client);
    await host.waitForHello(2000);
    await once(client, "message"); // consume el hello_ack

    client.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "discover") {
        client.send(JSON.stringify({ type: "discover.result", requestId: message.requestId, devices: [] }));
      }
    });

    const response = await host.request<DiscoverResultMessage>({
      type: "discover",
    });
    expect(response.devices).toEqual([]);

    client.close();
    host.close();
  });

  it("request() rechaza por timeout si no llega respuesta", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);
    await sendHello(client);
    await host.waitForHello(2000);
    await once(client, "message"); // consume el hello_ack

    await expect(host.request({ type: "discover" }, 50)).rejects.toThrow(/timeout/i);

    client.close();
    host.close();
  });

  it("ignora mensajes con forma inesperada sin romper la correlación de un request real", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);
    await sendHello(client);
    await host.waitForHello(2000);
    await once(client, "message"); // consume el hello_ack

    client.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "discover") {
        client.send("esto no es json valido {{{");
        client.send(JSON.stringify({ sinType: true }));
        client.send(JSON.stringify({ type: "discover.result", requestId: message.requestId, devices: [] }));
      }
    });

    const response = await host.request<DiscoverResultMessage>({
      type: "discover",
    });
    expect(response.devices).toEqual([]);

    client.close();
    host.close();
  });

  it("sendShutdown() manda el mensaje de shutdown al sidecar", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);
    await sendHello(client);
    await host.waitForHello(2000);
    await once(client, "message"); // consume el hello_ack

    const shutdownPromise = once(client, "message");
    host.sendShutdown();
    const raw = await shutdownPromise;
    expect(JSON.parse(String(raw))).toEqual({ type: "shutdown" });

    client.close();
    host.close();
  });

  it("onClosed() se dispara cuando el socket se cierra", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const client = connectClient(port);
    await sendHello(client);
    await host.waitForHello(2000);

    const closed = new Promise<void>((resolve) => host.onClosed(() => resolve()));
    client.close();
    await closed;

    host.close();
  });

  it("una segunda conexión mientras hay una activa se rechaza", async () => {
    const host = new SidecarWsHost(PLUGIN_ID, TOKEN);
    const { port } = await host.start();
    const first = connectClient(port);
    await sendHello(first);
    await host.waitForHello(2000);

    const second = connectClient(port);
    const closeCode = await once(second, "close");
    expect(closeCode).toBe(4000);

    first.close();
    host.close();
  });
});
