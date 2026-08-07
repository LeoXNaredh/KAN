import type { BleConnection, BleDeviceInfo, BluetoothTransportPort } from "../BluetoothTransportPort";

/**
 * Periférico BLE simulado para tests (mismo rol que FakeSerialTransport en
 * plugin-esp32-arduino) — y, hasta que un binding nativo real esté
 * disponible en un entorno dado, la implementación **por defecto** del
 * plugin (ver README.md).
 */
export interface FakeBleDevice {
  info: BleDeviceInfo;
  /** clave "serviceUuid:characteristicUuid" -> valor actual. */
  characteristics: Record<string, Buffer>;
  /** Si es `false`, connect() para este dispositivo falla (simula fuera de rango). */
  reachable?: boolean;
}

export class FakeBluetoothTransport implements BluetoothTransportPort {
  constructor(private readonly devices: FakeBleDevice[]) {}

  async scan(_timeoutMs: number): Promise<BleDeviceInfo[]> {
    return this.devices.map((device) => device.info);
  }

  async connect(address: string): Promise<BleConnection> {
    const device = this.devices.find((d) => d.info.address === address);
    if (!device || device.reachable === false) {
      throw new Error(`No se pudo conectar a ${address}`);
    }

    let connected = true;
    const key = (serviceUuid: string, characteristicUuid: string) => `${serviceUuid}:${characteristicUuid}`;

    return {
      readCharacteristic: async (serviceUuid, characteristicUuid) => {
        if (!connected) throw new Error("Conexión BLE cerrada");
        const value = device.characteristics[key(serviceUuid, characteristicUuid)];
        if (!value) throw new Error(`Característica desconocida: ${serviceUuid}/${characteristicUuid}`);
        return value;
      },
      writeCharacteristic: async (serviceUuid, characteristicUuid, value) => {
        if (!connected) throw new Error("Conexión BLE cerrada");
        device.characteristics[key(serviceUuid, characteristicUuid)] = value;
      },
      disconnect: async () => {
        connected = false;
      },
    };
  }
}
