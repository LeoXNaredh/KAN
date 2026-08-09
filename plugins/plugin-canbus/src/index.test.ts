import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { CanbusDevicePlugin } from "./index";
import { FakeCanbusTransport } from "./infra/FakeCanbusTransport";

describe("CanbusDevicePlugin", () => {
  const originalTargets = process.env.KAN_CANBUS_TARGETS;

  afterEach(() => {
    if (originalTargets === undefined) delete process.env.KAN_CANBUS_TARGETS;
    else process.env.KAN_CANBUS_TARGETS = originalTargets;
  });

  beforeEach(() => {
    delete process.env.KAN_CANBUS_TARGETS;
  });

  it("discover() devuelve lista vacía sin KAN_CANBUS_TARGETS configurado", async () => {
    const plugin = new CanbusDevicePlugin(new FakeCanbusTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los canales que abren, ignora los inalcanzables", async () => {
    process.env.KAN_CANBUS_TARGETS = "obd|COM3,roto|COM99";
    const transport = new FakeCanbusTransport({ COM3: {}, COM99: { reachable: false } });
    const plugin = new CanbusDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("obd");
    expect(devices[0].name).toContain("COM3@500000bps");
  });

  it("respeta un bitrate configurado explícitamente", async () => {
    process.env.KAN_CANBUS_TARGETS = "obd|COM3|250000";
    const transport = new FakeCanbusTransport({ COM3: {} });
    const plugin = new CanbusDevicePlugin(transport);

    const [device] = await plugin.discover();
    expect(device.name).toContain("COM3@250000bps");
  });

  it("un bitrate no soportado por SLCAN descarta el target (no lo reporta, no explota)", async () => {
    process.env.KAN_CANBUS_TARGETS = "malo|COM3|1234567";
    const plugin = new CanbusDevicePlugin(new FakeCanbusTransport({ COM3: {} }));
    expect(await plugin.discover()).toEqual([]);
  });

  it("expone 2 capabilities — send_frame con targetParam='canId', read_last_frames sin target", () => {
    const plugin = new CanbusDevicePlugin(new FakeCanbusTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["send_frame", "read_last_frames"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["irreversible-material", "read-only"]);
    expect(capabilities[0].targetParam).toBe("canId");
    expect(capabilities[1].targetParam).toBeUndefined();
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new CanbusDevicePlugin(new FakeCanbusTransport());
    const result = await plugin.invoke("canbus_desconocido", "send_frame", { canId: 0x100, data: [] });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: canbus_desconocido" });
  });

  describe("con un canal descubierto y conectado", () => {
    let plugin: CanbusDevicePlugin;
    let transport: FakeCanbusTransport;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_CANBUS_TARGETS = "obd|COM3";
      transport = new FakeCanbusTransport({ COM3: {} });
      plugin = new CanbusDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("read_last_frames devuelve vacío antes de recibir cualquier trama", async () => {
      const result = await plugin.invoke(deviceId, "read_last_frames", {});
      expect(result).toEqual({ success: true, data: { frames: [] } });
    });

    it("una trama entrante simulada del bus queda disponible en read_last_frames", async () => {
      transport.simulateIncoming("COM3", { canId: 0x123, extended: false, data: [0xaa, 0xbb] });

      const result = await plugin.invoke(deviceId, "read_last_frames", {});
      expect(result.success).toBe(true);
      const frames = (result.data as { frames: Array<{ canId: number; data: number[] }> }).frames;
      expect(frames).toHaveLength(1);
      expect(frames[0].canId).toBe(0x123);
      expect(frames[0].data).toEqual([0xaa, 0xbb]);
    });

    it("send_frame manda la trama real al transporte", async () => {
      const result = await plugin.invoke(deviceId, "send_frame", { canId: 0x123, data: [0x01, 0x02] });
      expect(result).toEqual({ success: true, data: {} });
      expect(transport.sentFrames).toEqual([
        { path: "COM3", frame: { canId: 0x123, extended: false, data: [0x01, 0x02] } },
      ]);
    });

    it("send_frame acepta trama extendida (29 bits)", async () => {
      const result = await plugin.invoke(deviceId, "send_frame", { canId: 0x1abcdef0, data: [], extended: true });
      expect(result).toEqual({ success: true, data: {} });
      expect(transport.sentFrames[0].frame.extended).toBe(true);
    });

    it("send_frame rechaza sin 'canId' numérico", async () => {
      const result = await plugin.invoke(deviceId, "send_frame", { data: [] });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/canId/);
    });

    it("send_frame rechaza más de 8 bytes de data", async () => {
      const result = await plugin.invoke(deviceId, "send_frame", { canId: 0x100, data: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/8 bytes/);
    });

    it("send_frame rechaza un byte de data fuera de 0-255", async () => {
      const result = await plugin.invoke(deviceId, "send_frame", { canId: 0x100, data: [300] });
      expect(result.success).toBe(false);
    });

    it("el buffer de tramas tiene un tope de 50 — no crece sin límite", async () => {
      for (let i = 0; i < 60; i++) transport.simulateIncoming("COM3", { canId: i, extended: false, data: [] });

      const result = await plugin.invoke(deviceId, "read_last_frames", {});
      const frames = (result.data as { frames: Array<{ canId: number }> }).frames;
      expect(frames.length).toBe(50);
      expect(frames[0].canId).toBe(10);
      expect(frames[49].canId).toBe(59);
    });

    it("send_frame falla con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);
      const result = await plugin.invoke(deviceId, "send_frame", { canId: 0x100, data: [] });
      expect(result).toEqual({ success: false, error: "Dispositivo no conectado" });
    });

    it("el buffer de tramas sobrevive a disconnect()", async () => {
      transport.simulateIncoming("COM3", { canId: 0x1, extended: false, data: [] });
      await plugin.disconnect(deviceId);

      const result = await plugin.invoke(deviceId, "read_last_frames", {});
      expect(result.success).toBe(true);
      expect((result.data as { frames: unknown[] }).frames).toHaveLength(1);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });
  });

  it("las tramas de un canal no se mezclan con las de otro (aislamiento multi-dispositivo)", async () => {
    process.env.KAN_CANBUS_TARGETS = "a|COM3,b|COM4";
    const transport = new FakeCanbusTransport({ COM3: {}, COM4: {} });
    const plugin = new CanbusDevicePlugin(transport);

    const devices = await plugin.discover();
    const [deviceA, deviceB] = devices;
    await plugin.connect(deviceA.id);
    await plugin.connect(deviceB.id);

    transport.simulateIncoming("COM3", { canId: 0x1, extended: false, data: [] });

    const readB = await plugin.invoke(deviceB.id, "read_last_frames", {});
    expect((readB.data as { frames: unknown[] }).frames).toHaveLength(0);
  });
});
