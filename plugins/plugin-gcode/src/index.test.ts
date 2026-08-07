import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GcodeDevicePlugin } from "./index";
import { FakeGcodeSerialTransport, type FakeGcodeDevice } from "./infra/FakeGcodeSerialTransport";

function createDevice(path: string, overrides: Partial<FakeGcodeDevice> = {}): FakeGcodeDevice {
  return {
    path,
    handle: (line) => {
      if (line === "M114") return ["X:0.00 Y:0.00 Z:0.00 E:0.00", "ok"];
      return ["ok"];
    },
    ...overrides,
  };
}

describe("GcodeDevicePlugin", () => {
  const originalPorts = process.env.KAN_GCODE_PORTS;

  afterEach(() => {
    if (originalPorts === undefined) delete process.env.KAN_GCODE_PORTS;
    else process.env.KAN_GCODE_PORTS = originalPorts;
  });

  beforeEach(() => {
    delete process.env.KAN_GCODE_PORTS;
  });

  it("discover() devuelve lista vacía sin KAN_GCODE_PORTS configurado — nunca escanea puertos sin configurar", async () => {
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([createDevice("COM3")]));
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los puertos configurados que abren", async () => {
    process.env.KAN_GCODE_PORTS = "COM3,COM9";
    const transport = new FakeGcodeSerialTransport([createDevice("COM3")]); // COM9 no existe en el fake -> open() lanza
    const plugin = new GcodeDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("COM3");
  });

  it("expone 8 capabilities con la severidad correcta — parar es siempre 'reversible', encender el spindle/láser es 'safety-critical'", () => {
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]));
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual([
      "home_axes",
      "move_axis",
      "set_temperature",
      "get_position",
      "start_spindle_or_laser",
      "stop_spindle_or_laser",
      "emergency_stop",
      "send_raw_gcode",
    ]);

    const severityOf = (name: string) => capabilities.find((c) => c.name === name)?.severity;
    expect(severityOf("emergency_stop")).toBe("reversible");
    expect(severityOf("stop_spindle_or_laser")).toBe("reversible");
    expect(severityOf("start_spindle_or_laser")).toBe("safety-critical");
    expect(severityOf("get_position")).toBe("read-only");
    expect(severityOf("move_axis")).toBe("irreversible-material");
    expect(severityOf("set_temperature")).toBe("irreversible-material");
  });

  it("listTargets() expone los 3 ejes y los 2 componentes de temperatura", () => {
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]));
    const targets = plugin.listTargets("any").map((t) => t.target);
    expect(targets).toEqual(["X", "Y", "Z", "hotend", "bed"]);
  });

  it("invoke() sobre un dispositivo no conectado da error, no throw", async () => {
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]));
    const result = await plugin.invoke("gcode_nunca_conectado", "get_position", {});
    expect(result).toEqual({ success: false, error: "Dispositivo no conectado: gcode_nunca_conectado" });
  });

  describe("con la máquina conectada", () => {
    let plugin: GcodeDevicePlugin;
    let deviceId: string;
    let receivedLines: string[];

    beforeEach(async () => {
      process.env.KAN_GCODE_PORTS = "COM3";
      receivedLines = [];
      const transport = new FakeGcodeSerialTransport([
        createDevice("COM3", {
          handle: (line) => {
            receivedLines.push(line);
            if (line === "M114") return ["X:0.00 Y:0.00 Z:0.00 E:0.00", "ok"];
            if (line === "send-error") return ["error:comando desconocido"];
            return ["ok"];
          },
        }),
      ]);
      plugin = new GcodeDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("home_axes sin 'axes' manda G28 solo", async () => {
      const result = await plugin.invoke(deviceId, "home_axes", {});
      expect(result).toEqual({ success: true, data: {} });
      expect(receivedLines).toEqual(["G28"]);
    });

    it("home_axes con 'axes' manda G28 <ejes>", async () => {
      await plugin.invoke(deviceId, "home_axes", { axes: "x y" });
      expect(receivedLines).toEqual(["G28 X Y"]);
    });

    it("move_axis rechaza un eje inválido", async () => {
      const result = await plugin.invoke(deviceId, "move_axis", { axis: "W", distanceMm: 10 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/axis/);
    });

    it("move_axis manda G91/G0/G90 en secuencia, con feed rate si se especifica", async () => {
      const result = await plugin.invoke(deviceId, "move_axis", { axis: "x", distanceMm: 10, feedRateMmPerMin: 1500 });
      expect(result).toEqual({ success: true, data: {} });
      expect(receivedLines).toEqual(["G91", "G0 X10 F1500", "G90"]);
    });

    it("move_axis sin feed rate omite el sufijo F", async () => {
      await plugin.invoke(deviceId, "move_axis", { axis: "Z", distanceMm: -5 });
      expect(receivedLines).toEqual(["G91", "G0 Z-5", "G90"]);
    });

    it("set_temperature traduce 'hotend' a M104 y 'bed' a M140", async () => {
      await plugin.invoke(deviceId, "set_temperature", { component: "hotend", celsius: 200 });
      await plugin.invoke(deviceId, "set_temperature", { component: "bed", celsius: 60 });
      expect(receivedLines).toEqual(["M104 S200", "M140 S60"]);
    });

    it("set_temperature rechaza un componente inválido", async () => {
      const result = await plugin.invoke(deviceId, "set_temperature", { component: "nozzle", celsius: 200 });
      expect(result.success).toBe(false);
    });

    it("get_position devuelve las líneas reportadas por la máquina antes del 'ok'", async () => {
      const result = await plugin.invoke(deviceId, "get_position", {});
      expect(result.success).toBe(true);
      expect((result.data as { response: string[] }).response).toEqual(["X:0.00 Y:0.00 Z:0.00 E:0.00"]);
      expect(receivedLines).toEqual(["M114"]);
    });

    it("start_spindle_or_laser por defecto (sin dirección) manda M3", async () => {
      await plugin.invoke(deviceId, "start_spindle_or_laser", {});
      expect(receivedLines).toEqual(["M3"]);
    });

    it("start_spindle_or_laser con dirección 'ccw' y power manda M4 S<power>", async () => {
      await plugin.invoke(deviceId, "start_spindle_or_laser", { direction: "ccw", power: 128 });
      expect(receivedLines).toEqual(["M4 S128"]);
    });

    it("start_spindle_or_laser rechaza una dirección inválida", async () => {
      const result = await plugin.invoke(deviceId, "start_spindle_or_laser", { direction: "sideways" });
      expect(result.success).toBe(false);
    });

    it("stop_spindle_or_laser manda M5", async () => {
      await plugin.invoke(deviceId, "stop_spindle_or_laser", {});
      expect(receivedLines).toEqual(["M5"]);
    });

    it("emergency_stop manda M112", async () => {
      await plugin.invoke(deviceId, "emergency_stop", {});
      expect(receivedLines).toEqual(["M112"]);
    });

    it("send_raw_gcode manda exactamente la línea dada", async () => {
      const result = await plugin.invoke(deviceId, "send_raw_gcode", { line: "G4 P500" });
      expect(result).toEqual({ success: true, data: {} });
      expect(receivedLines).toEqual(["G4 P500"]);
    });

    it("send_raw_gcode rechaza una línea vacía", async () => {
      const result = await plugin.invoke(deviceId, "send_raw_gcode", { line: "   " });
      expect(result.success).toBe(false);
    });

    it("una respuesta 'error:...' del firmware se traduce a success:false con el mensaje del firmware", async () => {
      const result = await plugin.invoke(deviceId, "send_raw_gcode", { line: "send-error" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("comando desconocido");
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("disconnect() seguido de invoke() da 'no conectado', no throw", async () => {
      await plugin.disconnect(deviceId);
      const result = await plugin.invoke(deviceId, "get_position", {});
      expect(result).toEqual({ success: false, error: `Dispositivo no conectado: ${deviceId}` });
    });
  });
});
