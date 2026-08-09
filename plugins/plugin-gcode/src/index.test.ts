import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GcodeDevicePlugin } from "./index";
import { FakeGcodeSerialTransport, type FakeGcodeDevice } from "./infra/FakeGcodeSerialTransport";
import { FakeGcodeNetworkTransport } from "./infra/FakeGcodeNetworkTransport";

function createDevice(path: string, overrides: Partial<FakeGcodeDevice> = {}): FakeGcodeDevice {
  return {
    path,
    handle: (line) => {
      if (line === "M114") return ["X:0.00 Y:0.00 Z:0.00 E:0.00", "ok"];
      if (line === "M105") return ["ok T:200.0 /200.0 B:60.0 /60.0 @:127 B@:0"];
      return ["ok"];
    },
    ...overrides,
  };
}

const ENV_KEYS = ["KAN_GCODE_SERIAL_PORT", "KAN_GCODE_WIFI_HOST", "KAN_GCODE_WIFI_PORT"] as const;

describe("GcodeDevicePlugin", () => {
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("discover() devuelve lista vacía sin nada configurado — nunca escanea puertos/hosts sin configurar", async () => {
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([createDevice("COM3")]));
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta el puerto serial configurado si abre", async () => {
    process.env.KAN_GCODE_SERIAL_PORT = "COM3";
    const transport = new FakeGcodeSerialTransport([createDevice("COM3")]);
    const plugin = new GcodeDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("COM3");
  });

  it("discover() no reporta nada si el puerto serial configurado no abre", async () => {
    process.env.KAN_GCODE_SERIAL_PORT = "COM9";
    const transport = new FakeGcodeSerialTransport([createDevice("COM3")]); // COM9 no existe -> open() lanza
    const plugin = new GcodeDevicePlugin(transport);

    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta el dispositivo WiFi si KAN_GCODE_WIFI_HOST/_PORT están configurados y responde", async () => {
    process.env.KAN_GCODE_WIFI_HOST = "192.168.1.50";
    process.env.KAN_GCODE_WIFI_PORT = "8899";
    const networkTransport = new FakeGcodeNetworkTransport([
      { host: "192.168.1.50", port: 8899, handle: () => ["ok"] },
    ]);
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]), networkTransport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("192.168.1.50:8899");
  });

  it("discover() ignora KAN_GCODE_WIFI_HOST sin KAN_GCODE_WIFI_PORT (o inválido) — nunca asume un puerto por defecto", async () => {
    process.env.KAN_GCODE_WIFI_HOST = "192.168.1.50";
    const networkTransport = new FakeGcodeNetworkTransport([
      { host: "192.168.1.50", port: 8899, handle: () => ["ok"] },
    ]);
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]), networkTransport);

    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() puede reportar serial y WiFi al mismo tiempo — dos dispositivos distintos", async () => {
    process.env.KAN_GCODE_SERIAL_PORT = "COM3";
    process.env.KAN_GCODE_WIFI_HOST = "192.168.1.50";
    process.env.KAN_GCODE_WIFI_PORT = "8899";
    const plugin = new GcodeDevicePlugin(
      new FakeGcodeSerialTransport([createDevice("COM3")]),
      new FakeGcodeNetworkTransport([{ host: "192.168.1.50", port: 8899, handle: () => ["ok"] }]),
    );

    const devices = await plugin.discover();
    expect(devices).toHaveLength(2);
  });

  it("expone 13 capabilities con la severidad correcta — parar/pausar es siempre 'reversible', encender el spindle/láser es 'safety-critical'", () => {
    const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]));
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual([
      "home_axes",
      "move_axis",
      "set_temperature",
      "get_position",
      "get_status",
      "print_file",
      "pause_print",
      "resume_print",
      "cancel_print",
      "start_spindle_or_laser",
      "stop_spindle_or_laser",
      "emergency_stop",
      "send_raw_gcode",
    ]);

    const severityOf = (name: string) => capabilities.find((c) => c.name === name)?.severity;
    expect(severityOf("emergency_stop")).toBe("reversible");
    expect(severityOf("stop_spindle_or_laser")).toBe("reversible");
    expect(severityOf("pause_print")).toBe("reversible");
    expect(severityOf("cancel_print")).toBe("reversible");
    expect(severityOf("resume_print")).toBe("irreversible-material");
    expect(severityOf("print_file")).toBe("irreversible-material");
    expect(severityOf("start_spindle_or_laser")).toBe("safety-critical");
    expect(severityOf("get_position")).toBe("read-only");
    expect(severityOf("get_status")).toBe("read-only");
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

  describe("con la máquina conectada por serial", () => {
    let plugin: GcodeDevicePlugin;
    let deviceId: string;
    let receivedLines: string[];

    beforeEach(async () => {
      process.env.KAN_GCODE_SERIAL_PORT = "COM3";
      receivedLines = [];
      const transport = new FakeGcodeSerialTransport([
        createDevice("COM3", {
          handle: (line) => {
            receivedLines.push(line);
            if (line === "M114") return ["X:0.00 Y:0.00 Z:0.00 E:0.00", "ok"];
            if (line === "M105") return ["ok T:200.0 /200.0 B:60.0 /60.0 @:127 B@:0"];
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

    it("get_status devuelve temperaturas parseadas y job:null sin impresión en curso", async () => {
      const result = await plugin.invoke(deviceId, "get_status", {});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        temperatures: { hotend: { current: 200, target: 200 }, bed: { current: 60, target: 60 } },
        job: null,
      });
      expect(receivedLines).toEqual(["M105"]);
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

  describe("control de impresión (print_file/pause/resume/cancel, P9 ADR-043)", () => {
    let plugin: GcodeDevicePlugin;
    let deviceId: string;
    let receivedLines: string[];

    beforeEach(async () => {
      process.env.KAN_GCODE_SERIAL_PORT = "COM3";
      receivedLines = [];
      const transport = new FakeGcodeSerialTransport([
        createDevice("COM3", {
          handle: (line) => {
            receivedLines.push(line);
            if (line === "M105") return ["ok T:200.0 /200.0 B:60.0 /60.0"];
            return ["ok"];
          },
        }),
      ]);
      plugin = new GcodeDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    async function flush() {
      // Deja correr las vueltas del loop de streaming (cada línea resuelve
      // por microtask en el fake) antes de seguir el test.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    it("print_file descarta comentarios/líneas vacías y devuelve totalLines ya filtrado", async () => {
      const gcode = "; comentario\nG28\n\nG1 X10 ; mover\n";
      const result = await plugin.invoke(deviceId, "print_file", { gcode, filename: "cubo.gcode" });
      expect(result).toEqual({ success: true, data: { totalLines: 2, filename: "cubo.gcode" } });
      await flush();
      expect(receivedLines).toEqual(["G28", "G1 X10"]);
    });

    it("print_file rechaza gcode vacío", async () => {
      const result = await plugin.invoke(deviceId, "print_file", { gcode: "   " });
      expect(result.success).toBe(false);
    });

    it("print_file rechaza si ya hay una impresión en curso", async () => {
      await plugin.invoke(deviceId, "print_file", { gcode: "G28\nG28\nG28" });
      const second = await plugin.invoke(deviceId, "print_file", { gcode: "G28" });
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/ya hay una impresión/i);
    });

    it("get_status refleja totalLines/status del job — pausado de inmediato para no competir con el propio streaming", async () => {
      await plugin.invoke(deviceId, "print_file", { gcode: "G28\nG28\nG28\nG28" });
      await plugin.invoke(deviceId, "pause_print", {});

      const status = await plugin.invoke(deviceId, "get_status", {});
      expect(status.success).toBe(true);
      const job = (status.data as { job: { status: string; totalLines: number } | null }).job;
      expect(job).not.toBeNull();
      expect(job?.totalLines).toBe(4);
      expect(job?.status).toBe("paused");
    });

    it("pause_print detiene el envío de líneas nuevas, resume_print lo retoma", async () => {
      const gcode = Array.from({ length: 5 }, () => "G28").join("\n");
      await plugin.invoke(deviceId, "print_file", { gcode });
      await flush();

      const pauseResult = await plugin.invoke(deviceId, "pause_print", {});
      expect(pauseResult.success).toBe(true);
      const linesAtPause = receivedLines.length;

      await flush();
      await flush();
      // Pausado: no deberían llegar líneas nuevas aunque pase tiempo/microtasks.
      expect(receivedLines.length).toBe(linesAtPause);

      const resumeResult = await plugin.invoke(deviceId, "resume_print", {});
      expect(resumeResult.success).toBe(true);
      await flush();
      await flush();
      await flush();
      expect(receivedLines.length).toBeGreaterThan(linesAtPause);
    });

    it("pause_print sin impresión en curso da error, no throw", async () => {
      const result = await plugin.invoke(deviceId, "pause_print", {});
      expect(result).toEqual({ success: false, error: "No hay ninguna impresión en curso en este dispositivo." });
    });

    it("resume_print sin impresión pausada da error, no throw", async () => {
      const result = await plugin.invoke(deviceId, "resume_print", {});
      expect(result.success).toBe(false);
    });

    it("cancel_print detiene el streaming y libera el dispositivo para un print_file nuevo", async () => {
      const gcode = Array.from({ length: 5 }, () => "G28").join("\n");
      await plugin.invoke(deviceId, "print_file", { gcode });
      await plugin.invoke(deviceId, "pause_print", {});

      const cancelResult = await plugin.invoke(deviceId, "cancel_print", {});
      expect(cancelResult.success).toBe(true);

      const statusAfterCancel = await plugin.invoke(deviceId, "get_status", {});
      expect((statusAfterCancel.data as { job: unknown }).job).toBeNull();

      const secondPrint = await plugin.invoke(deviceId, "print_file", { gcode: "G28" });
      expect(secondPrint.success).toBe(true);
    });

    it("cancel_print sin impresión en curso da error, no throw", async () => {
      const result = await plugin.invoke(deviceId, "cancel_print", {});
      expect(result.success).toBe(false);
    });

    it("un error del firmware a mitad de impresión pausa el job con lastError, no lo hace desaparecer", async () => {
      const failingTransport = new FakeGcodeSerialTransport([
        createDevice("COM3", {
          handle: (line) => {
            if (line === "G1 X999") return ["error:fuera de rango"];
            return ["ok"];
          },
        }),
      ]);
      const failingPlugin = new GcodeDevicePlugin(failingTransport);
      process.env.KAN_GCODE_SERIAL_PORT = "COM3";
      const [device] = await failingPlugin.discover();
      await failingPlugin.connect(device.id);

      await failingPlugin.invoke(device.id, "print_file", { gcode: "G28\nG1 X999\nG28" });
      await flush();
      await flush();

      const status = await failingPlugin.invoke(device.id, "get_status", {});
      const job = (status.data as { job: { status: string; lastError?: string } }).job;
      expect(job.status).toBe("paused");
      expect(job.lastError).toContain("fuera de rango");
    });
  });

  describe("con la máquina conectada por WiFi", () => {
    it("descubre, conecta e invoca capabilities igual que por serial", async () => {
      process.env.KAN_GCODE_WIFI_HOST = "192.168.1.50";
      process.env.KAN_GCODE_WIFI_PORT = "8899";
      const receivedLines: string[] = [];
      const networkTransport = new FakeGcodeNetworkTransport([
        {
          host: "192.168.1.50",
          port: 8899,
          handle: (line) => {
            receivedLines.push(line);
            return ["ok"];
          },
        },
      ]);
      const plugin = new GcodeDevicePlugin(new FakeGcodeSerialTransport([]), networkTransport);

      const [device] = await plugin.discover();
      await plugin.connect(device.id);
      const result = await plugin.invoke(device.id, "home_axes", {});

      expect(result).toEqual({ success: true, data: {} });
      expect(receivedLines).toEqual(["G28"]);
    });
  });
});
