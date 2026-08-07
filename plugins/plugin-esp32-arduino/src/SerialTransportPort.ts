import type { LineConnection } from "./LineConnection";

/**
 * Abstracción del transporte serial (ADR-012: testeable sin hardware real
 * con un fake que implementa el mismo contrato — ver infra/FakeSerialTransport.ts).
 * La implementación real (infra/NodeSerialTransport.ts) envuelve `serialport`.
 */
export interface PortInfo {
  path: string;
  manufacturer?: string;
}

/** Alias histórico — el shape real vive en LineConnection.ts, compartido con el transporte de red. */
export type SerialConnection = LineConnection;

export interface SerialTransportPort {
  list(): Promise<PortInfo[]>;
  open(path: string, baudRate: number): Promise<SerialConnection>;
}
