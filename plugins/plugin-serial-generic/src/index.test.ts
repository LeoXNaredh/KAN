import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SerialGenericDevicePlugin } from "./index";
import { FakeSerialTransport } from "./infra/FakeSerialTransport";

describe("SerialGenericDevicePlugin", () => {
  const originalTargets = process.env.KAN_SERIAL_TARGETS;

  afterEach(() => {
    if (originalTargets === undefined) delete process.env.KAN_SERIAL_TARGETS;
    else process.env.KAN_SERIAL_TARGETS = originalTargets;
  });

  beforeEach(() => {
    delete process.env.KAN_SERIAL_TARGETS;
  });

  it("discover() devuelve lista vacía sin KAN_SERIAL_TARGETS configurado", async () => {
    const plugin = new SerialGenericDevicePlugin(new FakeSerialTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los puertos que abren, ignora los inalcanzables", async () => {
    process.env.KAN_SERIAL_TARGETS = "sensor1|COM3,roto|COM99";
    const transport = new FakeSerialTransport({ COM3: {}, COM99: { reachable: false } });
    const plugin = new SerialGenericDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("sensor1");
    expect(devices[0].name).toContain("COM3@9600");
  });

  it("respeta un baudRate configurado explícitamente", async () => {
    process.env.KAN_SERIAL_TARGETS = "sensor1|COM3|115200";
    const transport = new FakeSerialTransport({ COM3: {} });
    const plugin = new SerialGenericDevicePlugin(transport);

    const [device] = await plugin.discover();
    expect(device.name).toContain("COM3@115200");
  });

  it("expone 2 capabilities, sin targetParam (sin sub-canales direccionables)", () => {
    const plugin = new SerialGenericDevicePlugin(new FakeSerialTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["send_line", "read_last_lines"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["irreversible-material", "read-only"]);
    expect(capabilities.every((c) => c.targetParam === undefined)).toBe(true);
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new SerialGenericDevicePlugin(new FakeSerialTransport());
    const result = await plugin.invoke("serial_desconocido", "send_line", { line: "hola" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: serial_desconocido" });
  });

  describe("con un puerto descubierto y conectado", () => {
    let plugin: SerialGenericDevicePlugin;
    let transport: FakeSerialTransport;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_SERIAL_TARGETS = "sensor1|COM3";
      transport = new FakeSerialTransport({ COM3: {} });
      plugin = new SerialGenericDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("read_last_lines devuelve vacío antes de recibir cualquier línea", async () => {
      const result = await plugin.invoke(deviceId, "read_last_lines", {});
      expect(result).toEqual({ success: true, data: { lines: [] } });
    });

    it("una línea entrante simulada del dispositivo queda disponible en read_last_lines", async () => {
      transport.simulateIncoming("COM3", "temperatura=21.5");

      const result = await plugin.invoke(deviceId, "read_last_lines", {});
      expect(result.success).toBe(true);
      const lines = (result.data as { lines: Array<{ line: string }> }).lines;
      expect(lines).toHaveLength(1);
      expect(lines[0].line).toBe("temperatura=21.5");
    });

    it("send_line manda la línea real al transporte", async () => {
      const result = await plugin.invoke(deviceId, "send_line", { line: "encender_rele" });
      expect(result).toEqual({ success: true, data: {} });
      expect(transport.writtenLines).toEqual([{ path: "COM3", line: "encender_rele" }]);
    });

    it("send_line rechaza sin 'line' string", async () => {
      const result = await plugin.invoke(deviceId, "send_line", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/line/);
    });

    it("el buffer de líneas tiene un tope de 50 — no crece sin límite", async () => {
      for (let i = 0; i < 60; i++) transport.simulateIncoming("COM3", `linea-${i}`);

      const result = await plugin.invoke(deviceId, "read_last_lines", {});
      const lines = (result.data as { lines: Array<{ line: string }> }).lines;
      expect(lines.length).toBe(50);
      expect(lines[0].line).toBe("linea-10");
      expect(lines[49].line).toBe("linea-59");
    });

    it("send_line falla con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);
      const result = await plugin.invoke(deviceId, "send_line", { line: "x" });
      expect(result).toEqual({ success: false, error: "Dispositivo no conectado" });
    });

    it("el buffer de líneas sobrevive a disconnect()", async () => {
      transport.simulateIncoming("COM3", "antes-de-desconectar");
      await plugin.disconnect(deviceId);

      const result = await plugin.invoke(deviceId, "read_last_lines", {});
      expect(result.success).toBe(true);
      expect((result.data as { lines: unknown[] }).lines).toHaveLength(1);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });
  });

  it("las líneas de un puerto no se mezclan con las de otro (aislamiento multi-dispositivo)", async () => {
    process.env.KAN_SERIAL_TARGETS = "a|COM3,b|COM4";
    const transport = new FakeSerialTransport({ COM3: {}, COM4: {} });
    const plugin = new SerialGenericDevicePlugin(transport);

    const devices = await plugin.discover();
    const [deviceA, deviceB] = devices;
    await plugin.connect(deviceA.id);
    await plugin.connect(deviceB.id);

    transport.simulateIncoming("COM3", "solo-para-A");

    const readB = await plugin.invoke(deviceB.id, "read_last_lines", {});
    expect((readB.data as { lines: unknown[] }).lines).toHaveLength(0);
  });
});
