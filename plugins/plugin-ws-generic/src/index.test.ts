import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { WsDevicePlugin } from "./index";
import { FakeWsTransport } from "./infra/FakeWsTransport";

const WS_URL = "ws://127.0.0.1:9001";

describe("WsDevicePlugin", () => {
  const originalEndpoints = process.env.KAN_WS_ENDPOINTS;

  afterEach(() => {
    if (originalEndpoints === undefined) delete process.env.KAN_WS_ENDPOINTS;
    else process.env.KAN_WS_ENDPOINTS = originalEndpoints;
  });

  beforeEach(() => {
    delete process.env.KAN_WS_ENDPOINTS;
  });

  it("discover() devuelve lista vacía sin KAN_WS_ENDPOINTS configurado", async () => {
    const plugin = new WsDevicePlugin(new FakeWsTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los endpoints que responden, ignora los inalcanzables", async () => {
    process.env.KAN_WS_ENDPOINTS = `echo|${WS_URL},roto|ws://127.0.0.1:9999`;
    const transport = new FakeWsTransport({ "ws://127.0.0.1:9999": { reachable: false } });
    const plugin = new WsDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("echo");
    expect(devices[0].name).toContain("127.0.0.1:9001");
  });

  it("el nombre del dispositivo nunca incluye el valor del header configurado", async () => {
    process.env.KAN_WS_ENDPOINTS = `echo|${WS_URL}|Authorization:Bearer super-secreto`;
    const plugin = new WsDevicePlugin(new FakeWsTransport());

    const [device] = await plugin.discover();
    expect(device.name).not.toContain("super-secreto");
  });

  it("expone 2 capabilities, sin targetParam (no hay topics/sub-canales)", () => {
    const plugin = new WsDevicePlugin(new FakeWsTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["send_ws_message", "read_ws_messages"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["irreversible-material", "read-only"]);
    expect(capabilities.every((c) => c.targetParam === undefined)).toBe(true);
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new WsDevicePlugin(new FakeWsTransport());
    const result = await plugin.invoke("ws_desconocido", "send_ws_message", { payload: "hola" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: ws_desconocido" });
  });

  describe("con un endpoint descubierto y conectado", () => {
    let plugin: WsDevicePlugin;
    let transport: FakeWsTransport;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_WS_ENDPOINTS = `echo|${WS_URL}`;
      transport = new FakeWsTransport();
      plugin = new WsDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("read_ws_messages devuelve vacío antes de recibir cualquier mensaje", async () => {
      const result = await plugin.invoke(deviceId, "read_ws_messages", {});
      expect(result).toEqual({ success: true, data: { messages: [] } });
    });

    it("un mensaje entrante simulado del servidor queda disponible en read_ws_messages", async () => {
      transport.simulateIncoming(WS_URL, "hola desde el server");

      const result = await plugin.invoke(deviceId, "read_ws_messages", {});
      expect(result.success).toBe(true);
      const messages = (result.data as { messages: Array<{ payload: string }> }).messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toBe("hola desde el server");
    });

    it("send_ws_message manda el payload sin error", async () => {
      const result = await plugin.invoke(deviceId, "send_ws_message", { payload: "hola" });
      expect(result).toEqual({ success: true, data: {} });
    });

    it("send_ws_message rechaza sin 'payload' string", async () => {
      const result = await plugin.invoke(deviceId, "send_ws_message", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/payload/);
    });

    it("el buffer de mensajes tiene un tope — no crece sin límite", async () => {
      for (let i = 0; i < 60; i++) transport.simulateIncoming(WS_URL, `msg-${i}`);

      const result = await plugin.invoke(deviceId, "read_ws_messages", {});
      const messages = (result.data as { messages: Array<{ payload: string }> }).messages;
      expect(messages.length).toBe(50);
      expect(messages[0].payload).toBe("msg-10"); // los primeros 10 se descartaron
      expect(messages[49].payload).toBe("msg-59");
    });

    it("send_ws_message falla con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);
      const result = await plugin.invoke(deviceId, "send_ws_message", { payload: "hola" });
      expect(result).toEqual({ success: false, error: "Dispositivo no conectado" });
    });

    it("el buffer de mensajes sobrevive a disconnect() — read_ws_messages sigue devolviendo lo ya recibido", async () => {
      transport.simulateIncoming(WS_URL, "antes de desconectar");
      await plugin.disconnect(deviceId);

      const result = await plugin.invoke(deviceId, "read_ws_messages", {});
      expect(result.success).toBe(true);
      const messages = (result.data as { messages: Array<{ payload: string }> }).messages;
      expect(messages).toHaveLength(1);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });
  });

  it("el buffer de mensajes de un dispositivo no se mezcla con el de otro (aislamiento multi-endpoint)", async () => {
    process.env.KAN_WS_ENDPOINTS = `a|ws://127.0.0.1:9001,b|ws://127.0.0.1:9002`;
    const transport = new FakeWsTransport();
    const plugin = new WsDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(2);
    const [deviceA, deviceB] = devices;
    await plugin.connect(deviceA.id);
    await plugin.connect(deviceB.id);

    transport.simulateIncoming("ws://127.0.0.1:9001", "solo-para-A");

    const readB = await plugin.invoke(deviceB.id, "read_ws_messages", {});
    expect((readB.data as { messages: unknown[] }).messages).toHaveLength(0);
  });
});
