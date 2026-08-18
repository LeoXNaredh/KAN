/** Un servicio anunciado por mDNS/Bonjour en la red local. */
export interface WifiScanEntry {
  /** Ej. "_esphomelib._tcp". */
  serviceType: string;
  /** Nombre de instancia anunciado. */
  name: string;
  address?: string;
  /** Hostname completo anunciado (ej. "tasmota-ABCD.local") — usado para heurísticas cuando el tipo de servicio no alcanza (ver `_http._tcp` en DeviceDiscoveryService). */
  host?: string;
}

/**
 * Escaneo mDNS pasivo (ADR-060) — nunca escanea IPs/puertos activamente
 * (mismo principio "nunca escanea" ya aplicado en plugin-mqtt/plugin-modbus),
 * solo escucha anuncios que la red ya está mandando por su cuenta.
 */
export interface WifiDeviceScannerPort {
  scan(durationMs: number): Promise<WifiScanEntry[]>;
}
