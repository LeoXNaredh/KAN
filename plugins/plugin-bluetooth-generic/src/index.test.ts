import { describe, expect, it, beforeEach } from "vitest";
import { BluetoothDevicePlugin } from "./index";
import { FakeBluetoothTransport, type FakeBleDevice } from "./infra/FakeBluetoothTransport";

const HEART_RATE_SERVICE = "180d";
const HEART_RATE_CHAR = "2a37";

function createFakeDevice(overrides: Partial<FakeBleDevice> = {}): FakeBleDevice {
  return {
    info: { address: "AA:BB:CC:DD:EE:FF", name: "Sensor de prueba", rssi: -50 },
    characteristics: { [`${HEART_RATE_SERVICE}:${HEART_RATE_CHAR}`]: Buffer.from("00", "hex") },
    ...overrides,
  };
}

describe("BluetoothDevicePlugin", () => {
  it("discover() devuelve un único dispositivo: el adaptador Bluetooth", async () => {
    const plugin = new BluetoothDevicePlugin(new FakeBluetoothTransport([]));
    const devices = await plugin.discover();
    expect(devices).toEqual([{ id: "bluetooth-adapter", name: "Adaptador Bluetooth", kind: "bluetooth-generic" }]);
  });

  it("expone 4 capabilities con la severidad correcta", () => {
    const plugin = new BluetoothDevicePlugin(new FakeBluetoothTransport([]));
    const capabilities = plugin.getCapabilities("bluetooth-adapter");

    expect(capabilities.map((c) => c.name)).toEqual([
      "scan_bluetooth_devices",
      "read_characteristic",
      "write_characteristic",
      "disconnect_bluetooth_device",
    ]);
    expect(capabilities.map((c) => c.severity)).toEqual([
      "read-only",
      "read-only",
      "irreversible-material",
      "reversible",
    ]);
    expect(capabilities.filter((c) => c.targetParam === "address")).toHaveLength(3);
  });

  it("listTargets() está vacío hasta el primer escaneo", () => {
    const plugin = new BluetoothDevicePlugin(new FakeBluetoothTransport([]));
    expect(plugin.listTargets("bluetooth-adapter")).toEqual([]);
  });

  describe("con el adaptador conectado", () => {
    let plugin: BluetoothDevicePlugin;

    beforeEach(async () => {
      const transport = new FakeBluetoothTransport([createFakeDevice()]);
      plugin = new BluetoothDevicePlugin(transport);
      await plugin.connect("bluetooth-adapter");
    });

    it("scan_bluetooth_devices devuelve los periféricos y alimenta listTargets()", async () => {
      const result = await plugin.invoke("bluetooth-adapter", "scan_bluetooth_devices", {});
      expect(result.success).toBe(true);
      expect((result.data as { devices: unknown[] }).devices).toHaveLength(1);

      const targets = plugin.listTargets("bluetooth-adapter");
      expect(targets).toEqual([
        { target: "AA:BB:CC:DD:EE:FF", suggestedAlias: "Sensor de prueba", defaultSeverity: "irreversible-material" },
      ]);
    });

    it("read_characteristic devuelve el valor actual en hexadecimal", async () => {
      const result = await plugin.invoke("bluetooth-adapter", "read_characteristic", {
        address: "AA:BB:CC:DD:EE:FF",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
      });
      expect(result).toEqual({ success: true, data: { value: "00" } });
    });

    it("write_characteristic escribe y un read_characteristic posterior refleja el cambio", async () => {
      const writeResult = await plugin.invoke("bluetooth-adapter", "write_characteristic", {
        address: "AA:BB:CC:DD:EE:FF",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
        value: "2a",
      });
      expect(writeResult).toEqual({ success: true, data: {} });

      const readResult = await plugin.invoke("bluetooth-adapter", "read_characteristic", {
        address: "AA:BB:CC:DD:EE:FF",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
      });
      expect(readResult).toEqual({ success: true, data: { value: "2a" } });
    });

    it("write_characteristic rechaza un value que no es hexadecimal válido", async () => {
      const result = await plugin.invoke("bluetooth-adapter", "write_characteristic", {
        address: "AA:BB:CC:DD:EE:FF",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
        value: "no-es-hex",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/hexadecimal/);
    });

    it("read_characteristic rechaza sin address", async () => {
      const result = await plugin.invoke("bluetooth-adapter", "read_characteristic", {
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/address/);
    });

    it("conectar a un dispositivo fuera de rango falla con un error claro, no lanza", async () => {
      const result = await plugin.invoke("bluetooth-adapter", "read_characteristic", {
        address: "NO:EX:IS:TE:00:00",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No se pudo conectar/);
    });

    it("disconnect_bluetooth_device desconecta y una siguiente lectura reconecta sola", async () => {
      await plugin.invoke("bluetooth-adapter", "read_characteristic", {
        address: "AA:BB:CC:DD:EE:FF",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
      });

      const disconnectResult = await plugin.invoke("bluetooth-adapter", "disconnect_bluetooth_device", {
        address: "AA:BB:CC:DD:EE:FF",
      });
      expect(disconnectResult).toEqual({ success: true, data: {} });

      const readAfter = await plugin.invoke("bluetooth-adapter", "read_characteristic", {
        address: "AA:BB:CC:DD:EE:FF",
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_CHAR,
      });
      expect(readAfter.success).toBe(true);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke("bluetooth-adapter", "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });
  });

  it("invoke rechaza un deviceId que no es el adaptador", async () => {
    const plugin = new BluetoothDevicePlugin(new FakeBluetoothTransport([]));
    const result = await plugin.invoke("otro-dispositivo", "scan_bluetooth_devices", {});
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: otro-dispositivo" });
  });
});
