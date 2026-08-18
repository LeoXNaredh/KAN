export interface BleScanEntry {
  /** Address/UUID del periférico, según lo exponga el adaptador BLE del SO. */
  id: string;
  name?: string;
  serviceUuids: string[];
}

/**
 * BLE es opcional por diseño (ADR-060): `@abandonware/noble` ya se intentó
 * una vez en este repo para `plugin-bluetooth-generic` y falló por falta de
 * toolchain de C++ en la máquina de desarrollo (ver su README) — reemplazado
 * ahí por un sidecar Python (`plugin-bluetooth-py`, `bleak`). Acá se
 * mantiene el intento vía `noble` (mismo criterio: si el binding nativo no
 * carga, `isAvailable()` da `false` y el resto del escaneo sigue sin BLE),
 * sin bloquear en el intento — igual que `GpioPort.isAccessible()`.
 */
export interface BleDeviceScannerPort {
  isAvailable(): boolean;
  scan(durationMs: number): Promise<BleScanEntry[]>;
}
