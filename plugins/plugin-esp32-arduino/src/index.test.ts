import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { SnapshotTransportPort, UploadSnapshotInput } from "@kan/plugin-contract";
import { Esp32ArduinoPlugin } from "./index";
import { FakeSerialTransport, type FakeDevice } from "./infra/FakeSerialTransport";
import { FakeNetworkTransport, type FakeNetworkDevice } from "./infra/FakeNetworkTransport";
import { FakeExternalProcess } from "./infra/FakeExternalProcess";

function fakeSnapshotTransport(): SnapshotTransportPort & { uploads: UploadSnapshotInput[] } {
  const uploads: UploadSnapshotInput[] = [];
  const stored = new Map<string, { content: Buffer; backupType: UploadSnapshotInput["backupType"] }>();
  let nextId = 0;
  return {
    uploads,
    upload: async (input) => {
      uploads.push(input);
      const snapshotId = `snap-${nextId++}`;
      stored.set(snapshotId, { content: input.content, backupType: input.backupType });
      return { snapshotId };
    },
    download: async (_deviceId, snapshotId) => {
      const entry = stored.get(snapshotId);
      if (!entry) throw new Error(`Snapshot desconocido: ${snapshotId}`);
      return entry;
    },
  };
}

function createEsp32Device(path: string): FakeDevice {
  const digitalState = new Map<number, boolean>();
  return {
    path,
    handle(command) {
      switch (command.cmd) {
        case "ping":
          return { ok: true, device: "kan-esp32" };
        case "read_digital":
          return { ok: true, value: digitalState.get(command.pin as number) ? 1 : 0 };
        case "read_analog":
          return { ok: true, value: 1234 };
        case "write_digital":
          digitalState.set(command.pin as number, command.value as boolean);
          return { ok: true };
        case "write_analog":
          return { ok: true };
        case "read_all": {
          const digital: Record<string, number> = {};
          for (const pin of (command.digitalPins as number[]) ?? []) {
            digital[String(pin)] = digitalState.get(pin) ? 1 : 0;
          }
          const analog: Record<string, number> = {};
          for (const pin of (command.analogPins as number[]) ?? []) {
            analog[String(pin)] = 1234;
          }
          return { ok: true, digital, analog };
        }
        default:
          return { ok: false, error: "comando desconocido" };
      }
    },
  };
}

function createForeignDevice(path: string): FakeDevice {
  // Un dispositivo serial ajeno a KAN: nunca responde nuestro protocolo.
  return { path, handle: () => undefined };
}

function createUnresponsiveAfterPingDevice(path: string): FakeDevice {
  // Responde el handshake pero se queda mudo en cualquier comando real (firmware colgado).
  return {
    path,
    handle: (command) => (command.cmd === "ping" ? { ok: true, device: "kan-esp32" } : undefined),
  };
}

function createEsp32NetworkDevice(host: string, port: number): FakeNetworkDevice {
  const digitalState = new Map<number, boolean>();
  return {
    host,
    port,
    handle(command) {
      switch (command.cmd) {
        case "ping":
          return { ok: true, device: "kan-esp32" };
        case "read_digital":
          return { ok: true, value: digitalState.get(command.pin as number) ? 1 : 0 };
        case "write_digital":
          digitalState.set(command.pin as number, command.value as boolean);
          return { ok: true };
        default:
          return { ok: false, error: "comando desconocido" };
      }
    },
  };
}

describe("Esp32ArduinoPlugin", () => {
  const originalPort = process.env.KAN_ESP32_PORT;
  const originalWifiHosts = process.env.KAN_ESP32_WIFI_HOSTS;

  afterEach(() => {
    if (originalPort === undefined) delete process.env.KAN_ESP32_PORT;
    else process.env.KAN_ESP32_PORT = originalPort;
    if (originalWifiHosts === undefined) delete process.env.KAN_ESP32_WIFI_HOSTS;
    else process.env.KAN_ESP32_WIFI_HOSTS = originalWifiHosts;
  });

  it("discover() encuentra solo los puertos que responden el protocolo KAN, ignora dispositivos ajenos", async () => {
    delete process.env.KAN_ESP32_PORT;
    const transport = new FakeSerialTransport([createEsp32Device("COM3"), createForeignDevice("COM4")]);
    const plugin = new Esp32ArduinoPlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("COM3");
  });

  it("discover() respeta KAN_ESP32_PORT y no escanea el resto de puertos", async () => {
    process.env.KAN_ESP32_PORT = "COM3";
    const transport = new FakeSerialTransport([createEsp32Device("COM3"), createEsp32Device("COM4")]);
    const plugin = new Esp32ArduinoPlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("COM3");
  });

  it("expone 5 capabilities, 4 direccionables por pin y discover_io_map a nivel de dispositivo", () => {
    const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]));
    const capabilities = plugin.getCapabilities("whatever");

    expect(capabilities.map((c) => c.name)).toEqual([
      "read_digital_pin",
      "read_analog_pin",
      "write_digital_pin",
      "write_analog_pin",
      "discover_io_map",
    ]);
    expect(capabilities.filter((c) => c.name !== "discover_io_map").every((c) => c.targetParam === "pin")).toBe(true);
    expect(capabilities.find((c) => c.name === "discover_io_map")?.targetParam).toBeUndefined();
    expect(capabilities.map((c) => c.severity)).toEqual([
      "read-only",
      "read-only",
      "irreversible-material",
      "irreversible-material",
      "read-only",
    ]);
  });

  it("listTargets() clasifica los pines solo-entrada como read-only y el resto como irreversible-material", () => {
    const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]));
    const targets = plugin.listTargets("whatever");

    expect(targets.find((t) => t.target === "34")?.defaultSeverity).toBe("read-only");
    expect(targets.find((t) => t.target === "5")?.defaultSeverity).toBe("irreversible-material");
  });

  describe("con un dispositivo descubierto y conectado", () => {
    let plugin: Esp32ArduinoPlugin;
    let deviceId: string;

    beforeEach(async () => {
      delete process.env.KAN_ESP32_PORT;
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      plugin = new Esp32ArduinoPlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("write_digital_pin en un pin válido con value boolean se ejecuta", async () => {
      const result = await plugin.invoke(deviceId, "write_digital_pin", { pin: 5, value: true });
      expect(result).toEqual({ success: true, data: {} });
    });

    it("read_digital_pin refleja el estado escrito previamente", async () => {
      await plugin.invoke(deviceId, "write_digital_pin", { pin: 5, value: true });
      const result = await plugin.invoke(deviceId, "read_digital_pin", { pin: 5 });
      expect(result).toEqual({ success: true, data: { value: 1 } });
    });

    it("read_analog_pin devuelve un valor numérico", async () => {
      const result = await plugin.invoke(deviceId, "read_analog_pin", { pin: 34 });
      expect(result).toEqual({ success: true, data: { value: 1234 } });
    });

    it("write_analog_pin en un pin PWM-capaz con value en rango se ejecuta", async () => {
      const result = await plugin.invoke(deviceId, "write_analog_pin", { pin: 5, value: 128 });
      expect(result).toEqual({ success: true, data: {} });
    });

    it("write_digital_pin rechaza un pin solo-entrada (34/35/36/39)", async () => {
      const result = await plugin.invoke(deviceId, "write_digital_pin", { pin: 34, value: true });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/solo-entrada/);
    });

    it("write_digital_pin rechaza value no-boolean (mismo hallazgo A1 que el simulador)", async () => {
      const result = await plugin.invoke(deviceId, "write_digital_pin", { pin: 5, value: "true" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/boolean/);
    });

    it("write_analog_pin rechaza value fuera de 0-255", async () => {
      const result = await plugin.invoke(deviceId, "write_analog_pin", { pin: 5, value: 300 });
      expect(result.success).toBe(false);
    });

    it("rechaza un pin desconocido", async () => {
      const result = await plugin.invoke(deviceId, "read_digital_pin", { pin: 99 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocido/);
    });

    it("rechaza un pin no-entero sin tocar el transporte", async () => {
      const result = await plugin.invoke(deviceId, "read_digital_pin", { pin: "5" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/entero/);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", { pin: 5 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("discover_io_map devuelve una entrada por pin conocido, con type/mode/value coherentes", async () => {
      await plugin.invoke(deviceId, "write_digital_pin", { pin: 5, value: true });
      const result = await plugin.invoke(deviceId, "discover_io_map", {});

      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ target: string; type: string; mode: string; value: unknown }> }).entries;
      expect(entries.length).toBe(23);

      const pin5 = entries.find((e) => e.target === "5");
      expect(pin5).toEqual({ target: "5", type: "digital", mode: "unknown", value: true });

      const pin34 = entries.find((e) => e.target === "34");
      expect(pin34).toEqual({ target: "34", type: "analog", mode: "input", value: 1234 });
    });

    it("disconnect() cierra la conexión; invoke posterior falla con dispositivo no conectado", async () => {
      await plugin.disconnect(deviceId);
      const result = await plugin.invoke(deviceId, "read_digital_pin", { pin: 5 });
      expect(result).toEqual({ success: false, error: `Dispositivo no conectado: ${deviceId}` });
    });
  });

  it("invoke sin connect() previo falla con dispositivo no conectado, no lanza", async () => {
    delete process.env.KAN_ESP32_PORT;
    const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
    const plugin = new Esp32ArduinoPlugin(transport);
    const [device] = await plugin.discover();

    const result = await plugin.invoke(device.id, "read_digital_pin", { pin: 5 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no conectado/);
  });

  it("un comando sin respuesta produce un timeout controlado, no una excepción sin manejar", async () => {
    delete process.env.KAN_ESP32_PORT;
    const transport = new FakeSerialTransport([createUnresponsiveAfterPingDevice("COM6")]);
    const plugin = new Esp32ArduinoPlugin(transport);
    const [device] = await plugin.discover();
    await plugin.connect(device.id);

    const result = await plugin.invoke(device.id, "read_digital_pin", { pin: 5 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no respondió a tiempo/);
  }, 5000);

  describe("por WiFi (KAN_ESP32_WIFI_HOSTS)", () => {
    beforeEach(() => {
      delete process.env.KAN_ESP32_PORT;
    });

    it("discover() encuentra dispositivos en los hosts configurados, nunca escanea la LAN", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.50:8266";
      const serialTransport = new FakeSerialTransport([]);
      const networkTransport = new FakeNetworkTransport([createEsp32NetworkDevice("192.168.1.50", 8266)]);
      const plugin = new Esp32ArduinoPlugin(serialTransport, networkTransport);

      const devices = await plugin.discover();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toContain("WiFi 192.168.1.50:8266");
    });

    it("usa el puerto por defecto (8266) si el host no especifica uno", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.50";
      const networkTransport = new FakeNetworkTransport([createEsp32NetworkDevice("192.168.1.50", 8266)]);
      const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]), networkTransport);

      const devices = await plugin.discover();
      expect(devices).toHaveLength(1);
    });

    it("ignora hosts que no responden el protocolo KAN", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.99:8266";
      const networkTransport = new FakeNetworkTransport([
        { host: "192.168.1.99", port: 8266, handle: () => undefined },
      ]);
      const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]), networkTransport);

      expect(await plugin.discover()).toHaveLength(0);
    });

    it("connect()/invoke() funcionan de punta a punta sobre una conexión WiFi", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.50:8266";
      const networkTransport = new FakeNetworkTransport([createEsp32NetworkDevice("192.168.1.50", 8266)]);
      const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]), networkTransport);

      const [device] = await plugin.discover();
      await plugin.connect(device.id);

      await plugin.invoke(device.id, "write_digital_pin", { pin: 5, value: true });
      const result = await plugin.invoke(device.id, "read_digital_pin", { pin: 5 });
      expect(result).toEqual({ success: true, data: { value: 1 } });
    });

    it("puede combinar un dispositivo Serial y uno WiFi al mismo tiempo", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.50:8266";
      const serialTransport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const networkTransport = new FakeNetworkTransport([createEsp32NetworkDevice("192.168.1.50", 8266)]);
      const plugin = new Esp32ArduinoPlugin(serialTransport, networkTransport);

      const devices = await plugin.discover();
      expect(devices).toHaveLength(2);
      expect(devices.some((d) => d.name.includes("Serial COM3"))).toBe(true);
      expect(devices.some((d) => d.name.includes("WiFi 192.168.1.50"))).toBe(true);
    });
  });

  describe("docs/06 — backup/restore de proyecto (Plataforma B)", () => {
    let sketchesDir: string;

    beforeEach(async () => {
      delete process.env.KAN_ESP32_PORT;
      delete process.env.KAN_ESP32_FQBN;
      sketchesDir = await mkdtemp(join(tmpdir(), "kan-esp32-sketches-test-"));
    });

    afterEach(async () => {
      await rm(sketchesDir, { recursive: true, force: true });
    });

    it("sin snapshotTransport, getCapabilities() no cambia (compatibilidad hacia atrás)", () => {
      const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]));
      expect(plugin.getCapabilities("whatever").map((c) => c.name)).toEqual([
        "read_digital_pin",
        "read_analog_pin",
        "write_digital_pin",
        "write_analog_pin",
        "discover_io_map",
      ]);
    });

    it("discover() con KAN_ESP32_PORT y snapshotTransport configurado registra un board sin bridge", async () => {
      process.env.KAN_ESP32_PORT = "COM3";
      const foreignDevice: FakeDevice = { path: "COM3", handle: () => undefined };
      const transport = new FakeSerialTransport([foreignDevice]);
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir);

      const devices = await plugin.discover();

      expect(devices).toHaveLength(1);
      expect(devices[0].name).toMatch(/sin firmware KAN/);
    });

    it("discover() con KAN_ESP32_PORT sin snapshotTransport NO registra un board sin bridge (comportamiento preexistente)", async () => {
      process.env.KAN_ESP32_PORT = "COM3";
      const foreignDevice: FakeDevice = { path: "COM3", handle: () => undefined };
      const transport = new FakeSerialTransport([foreignDevice]);
      const plugin = new Esp32ArduinoPlugin(transport);

      expect(await plugin.discover()).toHaveLength(0);
    });

    it("getCapabilities() de un board sin bridge expone solo project_*/compile_and_upload, nunca GPIO", async () => {
      process.env.KAN_ESP32_PORT = "COM3";
      const foreignDevice: FakeDevice = { path: "COM3", handle: () => undefined };
      const transport = new FakeSerialTransport([foreignDevice]);
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir);
      const [device] = await plugin.discover();

      const names = plugin.getCapabilities(device.id).map((c) => c.name);
      expect(names).toEqual(["project_list_files", "project_read_file", "project_save_snapshot", "project_restore_snapshot", "compile_and_upload"]);
    });

    it("getCapabilities() de un board CON bridge expone GPIO + project_*/compile_and_upload", async () => {
      delete process.env.KAN_ESP32_PORT;
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir);
      const [device] = await plugin.discover();

      const names = plugin.getCapabilities(device.id).map((c) => c.name);
      expect(names).toEqual([
        "read_digital_pin",
        "read_analog_pin",
        "write_digital_pin",
        "write_analog_pin",
        "discover_io_map",
        "project_list_files",
        "project_read_file",
        "project_save_snapshot",
        "project_restore_snapshot",
        "compile_and_upload",
      ]);
    });

    it("getCapabilities() de un dispositivo WiFi nunca expone project_*/compile_and_upload, aunque haya snapshotTransport", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.50:8266";
      const networkTransport = new FakeNetworkTransport([createEsp32NetworkDevice("192.168.1.50", 8266)]);
      const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]), networkTransport, fakeSnapshotTransport(), sketchesDir);
      const [device] = await plugin.discover();
      delete process.env.KAN_ESP32_WIFI_HOSTS;

      expect(plugin.getCapabilities(device.id).map((c) => c.name)).toEqual([
        "read_digital_pin",
        "read_analog_pin",
        "write_digital_pin",
        "write_analog_pin",
        "discover_io_map",
      ]);
    });

    it("project_restore_snapshot guarda el .ino localmente, y project_save_snapshot lo empaqueta de vuelta", async () => {
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const snapshotTransport = fakeSnapshotTransport();
      const plugin = new Esp32ArduinoPlugin(transport, undefined, snapshotTransport, sketchesDir);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);

      // "El usuario sube su .ino" — se modela como restaurar un snapshot 'source' guardado directo (docs/06, sin ida y vuelta al chip).
      const uploaded = await snapshotTransport.upload({
        deviceId: device.id,
        deviceKind: "esp32-arduino",
        backupType: "source",
        content: Buffer.from(JSON.stringify({ files: [{ path: "sketch.ino", content: "void setup(){}\nvoid loop(){}" }] }), "utf-8"),
      });

      const restoreResult = await plugin.invoke(device.id, "project_restore_snapshot", { snapshotId: uploaded.snapshotId });
      expect(restoreResult.success).toBe(true);

      const saveResult = await plugin.invoke(device.id, "project_save_snapshot", {});
      expect(saveResult.success).toBe(true);
      const bundle = JSON.parse(snapshotTransport.uploads.at(-1)!.content.toString("utf-8"));
      expect(bundle.files).toEqual([{ path: `${device.id}.ino`, content: "void setup(){}\nvoid loop(){}" }]);
    });

    it("compile_and_upload sin sketch guardado devuelve un error claro", async () => {
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);

      const result = await plugin.invoke(device.id, "compile_and_upload", { fqbn: "esp32:esp32:esp32" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No hay un sketch/);
    });

    it("compile_and_upload sin 'fqbn' ni KAN_ESP32_FQBN devuelve un error claro", async () => {
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);
      await plugin.writeFile(device.id, "sketch.ino", "void setup(){}");

      const result = await plugin.invoke(device.id, "compile_and_upload", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/fqbn/);
    });

    it("compile_and_upload compila y sube con arduino-cli, y el bridge sigue funcionando después", async () => {
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const externalProcess = new FakeExternalProcess(() => ({ exitCode: 0, stderr: "" }));
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir, externalProcess);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);
      await plugin.writeFile(device.id, "sketch.ino", "void setup(){}");

      const result = await plugin.invoke(device.id, "compile_and_upload", { fqbn: "esp32:esp32:esp32" });

      expect(result).toEqual({ success: true, data: { fqbn: "esp32:esp32:esp32" } });
      expect(externalProcess.calls).toHaveLength(2);
      expect(externalProcess.calls[0]).toMatchObject({ command: "arduino-cli", args: ["compile", "--fqbn", "esp32:esp32:esp32", join(sketchesDir, device.id)] });
      expect(externalProcess.calls[1]).toMatchObject({
        command: "arduino-cli",
        args: ["upload", "--fqbn", "esp32:esp32:esp32", "--port", "COM3", join(sketchesDir, device.id)],
      });

      // El puerto se soltó para arduino-cli y se reabrió después (había bridge) — GPIO sigue andando.
      const gpioResult = await plugin.invoke(device.id, "write_digital_pin", { pin: 5, value: true });
      expect(gpioResult.success).toBe(true);
    });

    it("compile_and_upload propaga el error de arduino-cli si el compile falla", async () => {
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const externalProcess = new FakeExternalProcess(() => ({ exitCode: 1, stderr: "sketch.ino:1:1: error: expected..." }));
      const plugin = new Esp32ArduinoPlugin(transport, undefined, fakeSnapshotTransport(), sketchesDir, externalProcess);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);
      await plugin.writeFile(device.id, "sketch.ino", "esto no compila");

      const result = await plugin.invoke(device.id, "compile_and_upload", { fqbn: "esp32:esp32:esp32" });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/expected/);
      expect(externalProcess.calls).toHaveLength(1); // nunca llega a "upload" si "compile" falló
    });

    it("compile_and_upload rechaza un dispositivo conectado por WiFi (arduino-cli necesita un puerto serial real)", async () => {
      process.env.KAN_ESP32_WIFI_HOSTS = "192.168.1.50:8266";
      const networkTransport = new FakeNetworkTransport([createEsp32NetworkDevice("192.168.1.50", 8266)]);
      const plugin = new Esp32ArduinoPlugin(new FakeSerialTransport([]), networkTransport, fakeSnapshotTransport(), sketchesDir);
      const [device] = await plugin.discover();
      delete process.env.KAN_ESP32_WIFI_HOSTS;
      await plugin.connect(device.id);
      await plugin.writeFile(device.id, "sketch.ino", "void setup(){}");

      const result = await plugin.invoke(device.id, "compile_and_upload", { fqbn: "esp32:esp32:esp32" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/serial/);
    });

    it("project_save_snapshot con backupType 'binary' lee el flash vía esptool.py", async () => {
      const transport = new FakeSerialTransport([createEsp32Device("COM3")]);
      const flashBytes = Buffer.from([1, 2, 3, 4]);
      const externalProcess = new FakeExternalProcess(async (call) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(call.args[call.args.length - 1], flashBytes);
        return { exitCode: 0, stderr: "" };
      });
      const snapshotTransport = fakeSnapshotTransport();
      const plugin = new Esp32ArduinoPlugin(transport, undefined, snapshotTransport, sketchesDir, externalProcess);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);

      const result = await plugin.invoke(device.id, "project_save_snapshot", { backupType: "binary" });

      expect(result.success).toBe(true);
      expect(externalProcess.calls[0].command).toBe("esptool.py");
      expect(snapshotTransport.uploads[0].content.equals(flashBytes)).toBe(true);
      expect(snapshotTransport.uploads[0]).toMatchObject({ backupType: "binary" });

      // El puerto se soltó para esptool y se reabrió después — GPIO sigue andando.
      const gpioResult = await plugin.invoke(device.id, "read_digital_pin", { pin: 5 });
      expect(gpioResult.success).toBe(true);
    });
  });
});
