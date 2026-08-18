import type { DiscoveredDeviceTransport } from "./DiscoveredDevice";

/**
 * Registro persistido de un dispositivo ya visto alguna vez (memoria de
 * dispositivos entre reinicios) — deliberadamente más chico que `Device`:
 * no guarda `capabilities`/`status`, que solo tienen sentido para un
 * dispositivo conectado ahora mismo en esta sesión (ver DeviceManager).
 */
export interface KnownDeviceRecord {
  id: string;
  name: string;
  transport?: DiscoveredDeviceTransport;
  address?: string;
  /** ISO 8601 — última vez que `DeviceManager` lo descubrió/conectó. */
  lastSeenAt: string;
}
