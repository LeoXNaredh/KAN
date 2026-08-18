import type { BleDeviceScannerPort, BleScanEntry } from "../domain/ports/BleDeviceScannerPort";

/** BLE ausente (ADR-060) — cuando `@abandonware/noble` no pudo cargarse (ver `NobleBleScanner`), `DeviceDiscoveryService` sigue funcionando sin BLE en vez de fallar. */
export class NullBleScanner implements BleDeviceScannerPort {
  isAvailable(): boolean {
    return false;
  }

  async scan(): Promise<BleScanEntry[]> {
    return [];
  }
}
