import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Esp32ArduinoPlugin } from "./index";
import { FakeSerialTransport, type FakeDevice } from "./infra/FakeSerialTransport";
import { FakeNetworkTransport, type FakeNetworkDevice } from "./infra/FakeNetworkTransport";

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
});
