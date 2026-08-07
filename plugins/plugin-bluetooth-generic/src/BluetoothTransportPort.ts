/**
 * Abstracción de BLE central-mode (escanear + conectar + leer/escribir
 * características GATT). Igual que SerialTransportPort/NetworkTransportPort
 * en plugin-esp32-arduino: testeable sin hardware con un fake (ver
 * infra/FakeBluetoothTransport.ts). La implementación real depende de una
 * librería nativa de Node — ver README.md sobre el protocolo de fallback si
 * no instala en un entorno dado.
 */
export interface BleDeviceInfo {
  address: string;
  name?: string;
  rssi?: number;
}

export interface BleConnection {
  readCharacteristic(serviceUuid: string, characteristicUuid: string): Promise<Buffer>;
  writeCharacteristic(serviceUuid: string, characteristicUuid: string, value: Buffer): Promise<void>;
  disconnect(): Promise<void>;
}

export interface BluetoothTransportPort {
  scan(timeoutMs: number): Promise<BleDeviceInfo[]>;
  connect(address: string): Promise<BleConnection>;
}
