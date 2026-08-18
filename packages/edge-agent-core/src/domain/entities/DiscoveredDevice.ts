export type DiscoveredDeviceTransport = "serial" | "wifi" | "bluetooth";
export type DiscoveredDeviceConfidence = "exact" | "partial" | "unknown";

/**
 * Un dispositivo físico visto por `DeviceDiscoveryService` (ADR-060) — no
 * necesariamente algo que KAN sepa controlar todavía; solo lo que el SO/red
 * confirma que existe. `confidence` distingue "matcheó exacto contra el
 * catálogo VID/PID o un tipo mDNS conocido" de "se infirió por heurística
 * (ej. hostname)" de "no se pudo identificar en absoluto" — nunca se asume
 * qué es un dispositivo sin evidencia (mismo principio que ADR-058 con los pines).
 */
export interface DiscoveredDevice {
  id: string;
  transport: DiscoveredDeviceTransport;
  /** Solo para `transport: "serial"` — ej. "COM3", "/dev/ttyUSB0". */
  port?: string;
  /** Para `transport: "wifi"` (IP) o `"bluetooth"` (address/UUID del periférico). */
  address?: string;
  name: string;
  confidence: DiscoveredDeviceConfidence;
  /** Datos crudos del scanner correspondiente, sin procesar — para debugging y para no perder información que el matching descartó. */
  raw: Record<string, unknown>;
}

export interface DiscoveryResult {
  devices: DiscoveredDevice[];
  scannedAt: Date;
  durationMs: number;
}
