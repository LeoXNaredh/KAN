import { randomUUID } from "node:crypto";
import type { SerialTransportPort, PortInfo } from "@kan/serial-line-transport";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { WifiDeviceScannerPort, WifiScanEntry } from "../domain/ports/WifiDeviceScannerPort";
import type { BleDeviceScannerPort, BleScanEntry } from "../domain/ports/BleDeviceScannerPort";
import type { DiscoveredDevice, DiscoveredDeviceConfidence, DiscoveryResult } from "../domain/entities/DiscoveredDevice";
import { findInVidPidCatalog, type VidPidCatalogEntry } from "../domain/entities/VidPidCatalogEntry";

const DEFAULT_WIFI_SCAN_MS = 10_000;
const DEFAULT_BLE_SCAN_MS = 15_000;

const WIFI_SERVICE_LABELS: Record<string, string> = {
  "_arduino._tcp": "Arduino con OTA habilitado",
  "_esphomelib._tcp": "ESP32/ESP8266 (ESPHome)",
  "_shelly._tcp": "Shelly (relé / foco / enchufe smart)",
  "_hue._tcp": "Philips Hue Bridge",
  "_mqtt._tcp": "Broker MQTT local",
};

const BLE_SERVICE_LABELS: Record<string, string> = {
  "180d": "Monitor cardíaco / wearable",
  "181a": "Sensor ambiental BLE",
  "1812": "HID (teclado/mouse/gamepad)",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e": "UART Nordic (ESP32/Arduino)",
};

export interface DeviceDiscoveryServiceDeps {
  serialTransport: SerialTransportPort;
  wifiScanner: WifiDeviceScannerPort;
  bleScanner: BleDeviceScannerPort;
  logger: LoggerPort;
  catalog: VidPidCatalogEntry[];
  wifiScanDurationMs?: number;
  bleScanDurationMs?: number;
}

/**
 * Detección automática de dispositivos físicos conectados — serial (VID/PID
 * contra catálogo), WiFi (mDNS pasivo) y Bluetooth BLE (opcional) — ADR-060,
 * complemento de `discover_io_map` (ADR-058): eso lee el estado de un
 * dispositivo YA conocido; esto encuentra qué dispositivos existen antes de
 * que ningún plugin los conozca.
 *
 * Los 3 transportes se escanean en paralelo (`Promise.allSettled`) y son
 * independientes entre sí a propósito — el fallo de uno (sin puertos
 * seriales, red sin mDNS activo, BLE sin binding nativo) nunca tumba a los
 * otros dos, cada uno simplemente aporta una lista vacía.
 */
export class DeviceDiscoveryService {
  constructor(private readonly deps: DeviceDiscoveryServiceDeps) {}

  async scan(): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    const [serial, wifi, ble] = await Promise.allSettled([this.scanSerial(), this.scanWifi(), this.scanBle()]);

    const devices: DiscoveredDevice[] = [
      ...this.settledOrEmpty("serial", serial),
      ...this.settledOrEmpty("wifi", wifi),
      ...this.settledOrEmpty("bluetooth", ble),
    ];

    return { devices, scannedAt: new Date(), durationMs: Date.now() - startedAt };
  }

  private settledOrEmpty(transport: string, result: PromiseSettledResult<DiscoveredDevice[]>): DiscoveredDevice[] {
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    this.deps.logger.warn(`DeviceDiscoveryService: el escaneo de ${transport} falló, se continúa con el resto — ${reason}`);
    return [];
  }

  private async scanSerial(): Promise<DiscoveredDevice[]> {
    const ports = await this.deps.serialTransport.list();
    return ports.map((port) => this.matchSerialPort(port));
  }

  private matchSerialPort(port: PortInfo): DiscoveredDevice {
    const match =
      port.vendorId && port.productId ? findInVidPidCatalog(this.deps.catalog, port.vendorId, port.productId) : undefined;
    return {
      id: randomUUID(),
      transport: "serial",
      port: port.path,
      name: match?.name ?? "Dispositivo serial no identificado",
      confidence: match ? "exact" : "unknown",
      raw: { path: port.path, manufacturer: port.manufacturer, vendorId: port.vendorId, productId: port.productId },
    };
  }

  private async scanWifi(): Promise<DiscoveredDevice[]> {
    const entries = await this.deps.wifiScanner.scan(this.deps.wifiScanDurationMs ?? DEFAULT_WIFI_SCAN_MS);
    return entries.map((entry) => this.matchWifiEntry(entry));
  }

  private matchWifiEntry(entry: WifiScanEntry): DiscoveredDevice {
    let name = WIFI_SERVICE_LABELS[entry.serviceType];
    let confidence: DiscoveredDeviceConfidence = name ? "exact" : "unknown";

    if (!name && entry.serviceType === "_http._tcp") {
      const host = (entry.host ?? entry.name ?? "").toLowerCase();
      if (host.includes("tasmota")) {
        name = "Dispositivo Tasmota (foco/enchufe)";
        confidence = "partial";
      } else if (host.includes("octoprint")) {
        name = "Impresora 3D (OctoPrint)";
        confidence = "partial";
      }
    }

    return {
      id: randomUUID(),
      transport: "wifi",
      address: entry.address,
      name: name ?? `Dispositivo de red (${entry.serviceType})`,
      confidence,
      raw: { serviceType: entry.serviceType, name: entry.name, address: entry.address, host: entry.host },
    };
  }

  private async scanBle(): Promise<DiscoveredDevice[]> {
    if (!this.deps.bleScanner.isAvailable()) {
      this.deps.logger.warn(
        "DeviceDiscoveryService: BLE no disponible en este host (falta @abandonware/noble o su binding nativo) — se omite, el resto del escaneo continúa.",
      );
      return [];
    }
    const entries = await this.deps.bleScanner.scan(this.deps.bleScanDurationMs ?? DEFAULT_BLE_SCAN_MS);
    return entries.map((entry) => this.matchBleEntry(entry));
  }

  private matchBleEntry(entry: BleScanEntry): DiscoveredDevice {
    const matchedUuid = entry.serviceUuids.map((uuid) => uuid.toLowerCase()).find((uuid) => BLE_SERVICE_LABELS[uuid]);
    const name = matchedUuid ? BLE_SERVICE_LABELS[matchedUuid] : entry.name || "Dispositivo BLE sin identificar";
    const confidence: DiscoveredDeviceConfidence = matchedUuid ? "exact" : entry.name ? "partial" : "unknown";

    return {
      id: randomUUID(),
      transport: "bluetooth",
      address: entry.id,
      name,
      confidence,
      raw: { id: entry.id, name: entry.name, serviceUuids: entry.serviceUuids },
    };
  }
}
