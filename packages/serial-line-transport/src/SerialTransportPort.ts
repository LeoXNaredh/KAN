import type { LineConnection } from "./LineConnection";

/**
 * Abstracción del transporte serial (ADR-012: testeable sin hardware real
 * con un fake que implementa el mismo contrato). La implementación real
 * (infra/NodeSerialTransport.ts) envuelve `serialport`.
 */
export interface PortInfo {
  path: string;
  manufacturer?: string;
  /** Hex sin prefijo "0x" (ej. "2341"), tal cual lo expone `serialport` — `undefined` si el driver USB del SO no lo reportó. */
  vendorId?: string;
  productId?: string;
}

/** Alias histórico (viene de plugin-esp32-arduino) — el shape real vive en LineConnection.ts. */
export type SerialConnection = LineConnection;

export interface SerialTransportPort {
  list(): Promise<PortInfo[]>;
  /** `delimiter` por defecto `"\n"` — SLCAN (plugin-canbus) usa `"\r"`. */
  open(path: string, baudRate: number, delimiter?: string): Promise<SerialConnection>;
}
