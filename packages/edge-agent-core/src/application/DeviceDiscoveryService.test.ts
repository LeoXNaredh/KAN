import { describe, expect, it, vi } from "vitest";
import type { SerialTransportPort, PortInfo, SerialConnection } from "@kan/serial-line-transport";
import type { WifiDeviceScannerPort, WifiScanEntry } from "../domain/ports/WifiDeviceScannerPort";
import type { BleDeviceScannerPort, BleScanEntry } from "../domain/ports/BleDeviceScannerPort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { VidPidCatalogEntry } from "../domain/entities/VidPidCatalogEntry";
import { DeviceDiscoveryService } from "./DeviceDiscoveryService";

function fakeSerialTransport(ports: PortInfo[]): SerialTransportPort {
  return {
    list: async () => ports,
    open: async (): Promise<SerialConnection> => {
      throw new Error("no usado en estos tests");
    },
  };
}

function fakeWifiScanner(entries: WifiScanEntry[] | (() => Promise<WifiScanEntry[]>)): WifiDeviceScannerPort {
  return { scan: async () => (typeof entries === "function" ? entries() : entries) };
}

function fakeBleScanner(available: boolean, entries: BleScanEntry[] = []): BleDeviceScannerPort {
  return {
    isAvailable: () => available,
    scan: async () => entries,
  };
}

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const CATALOG: VidPidCatalogEntry[] = [{ vendorId: "0x2341", productId: "0x0043", name: "Arduino Uno R3 (original)" }];

describe("DeviceDiscoveryService", () => {
  it("matchea un puerto serial contra el catálogo por VID/PID (case-insensitive, con o sin prefijo 0x)", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([{ path: "COM3", vendorId: "2341", productId: "0043" }]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: CATALOG,
    });

    const result = await service.scan();

    expect(result.devices).toEqual([
      {
        id: expect.any(String),
        transport: "serial",
        port: "COM3",
        name: "Arduino Uno R3 (original)",
        confidence: "exact",
        raw: { path: "COM3", manufacturer: undefined, vendorId: "2341", productId: "0043" },
      },
    ]);
  });

  it("un puerto serial sin match en el catálogo se reporta como no identificado, no se descarta", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([{ path: "COM9", vendorId: "FFFF", productId: "FFFF" }]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: CATALOG,
    });

    const result = await service.scan();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({ name: "Dispositivo serial no identificado", confidence: "unknown" });
  });

  it("un puerto sin vendorId/productId (SO no lo reportó) nunca intenta matchear, queda 'unknown'", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([{ path: "COM1" }]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: CATALOG,
    });

    const result = await service.scan();

    expect(result.devices[0].confidence).toBe("unknown");
  });

  it("clasifica un tipo mDNS conocido con confidence 'exact'", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([{ serviceType: "_esphomelib._tcp", name: "sensor-cocina", address: "192.168.1.50" }]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices).toEqual([
      {
        id: expect.any(String),
        transport: "wifi",
        address: "192.168.1.50",
        name: "ESP32/ESP8266 (ESPHome)",
        confidence: "exact",
        raw: { serviceType: "_esphomelib._tcp", name: "sensor-cocina", address: "192.168.1.50", host: undefined },
      },
    ]);
  });

  it("un _http._tcp con hostname 'tasmota' se clasifica por heurística con confidence 'partial'", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([{ serviceType: "_http._tcp", name: "enchufe", host: "tasmota-ABCD.local" }]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices[0]).toMatchObject({ name: "Dispositivo Tasmota (foco/enchufe)", confidence: "partial" });
  });

  it("un _http._tcp con hostname 'octoprint' se clasifica como impresora 3D", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([{ serviceType: "_http._tcp", name: "impresora", host: "octoprint.local" }]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices[0]).toMatchObject({ name: "Impresora 3D (OctoPrint)", confidence: "partial" });
  });

  it("un _http._tcp sin heurística conocida queda 'unknown', con nombre genérico", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([{ serviceType: "_http._tcp", name: "algo", host: "router.local" }]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices[0]).toMatchObject({ confidence: "unknown" });
  });

  it("BLE no disponible: se omite sin tirar, el resto del escaneo sigue normal", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([{ path: "COM3", vendorId: "2341", productId: "0043" }]),
      wifiScanner: fakeWifiScanner([{ serviceType: "_mqtt._tcp", name: "broker" }]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: CATALOG,
    });

    const result = await service.scan();

    expect(result.devices).toHaveLength(2);
    expect(result.devices.some((d) => d.transport === "bluetooth")).toBe(false);
  });

  it("BLE disponible: matchea un UUID de servicio conocido (case-insensitive)", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(true, [
        { id: "aa:bb:cc", name: "Reloj", serviceUuids: ["180D"] },
      ]),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices).toEqual([
      {
        id: expect.any(String),
        transport: "bluetooth",
        address: "aa:bb:cc",
        name: "Monitor cardíaco / wearable",
        confidence: "exact",
        raw: { id: "aa:bb:cc", name: "Reloj", serviceUuids: ["180D"] },
      },
    ]);
  });

  it("un periférico BLE sin UUID conocido pero con nombre queda 'partial'", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(true, [{ id: "aa:bb:cc", name: "MiSensor", serviceUuids: [] }]),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices[0]).toMatchObject({ name: "MiSensor", confidence: "partial" });
  });

  it("un periférico BLE sin nombre ni UUID conocido queda 'unknown'", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(true, [{ id: "aa:bb:cc", serviceUuids: [] }]),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices[0]).toMatchObject({ name: "Dispositivo BLE sin identificar", confidence: "unknown" });
  });

  it("si el scanner WiFi rechaza (ej. sin mDNS activo en la red), se registra un warning y el resto del escaneo sigue", async () => {
    const logger = createLogger();
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([{ path: "COM3", vendorId: "2341", productId: "0043" }]),
      wifiScanner: fakeWifiScanner(() => Promise.reject(new Error("sin red"))),
      bleScanner: fakeBleScanner(false),
      logger,
      catalog: CATALOG,
    });

    const result = await service.scan();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].transport).toBe("serial");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("wifi"));
  });

  it("si el transporte serial rechaza, no tumba wifi/BLE — cada transporte es independiente", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: { list: () => Promise.reject(new Error("puerto ocupado")), open: fakeSerialTransport([]).open },
      wifiScanner: fakeWifiScanner([{ serviceType: "_mqtt._tcp", name: "broker" }]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: [],
    });

    const result = await service.scan();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].transport).toBe("wifi");
  });

  it("devuelve scannedAt y durationMs coherentes", async () => {
    const service = new DeviceDiscoveryService({
      serialTransport: fakeSerialTransport([]),
      wifiScanner: fakeWifiScanner([]),
      bleScanner: fakeBleScanner(false),
      logger: createLogger(),
      catalog: [],
    });

    const before = Date.now();
    const result = await service.scan();

    expect(result.scannedAt).toBeInstanceOf(Date);
    expect(result.scannedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
