/**
 * Abstracción del transporte serial (ADR-012: testeable sin hardware real
 * con un fake que implementa el mismo contrato — ver infra/FakeSerialTransport.ts).
 * La implementación real (infra/NodeSerialTransport.ts) envuelve `serialport`.
 */
export interface PortInfo {
  path: string;
  manufacturer?: string;
}

export interface SerialConnection {
  write(line: string): void;
  /** Devuelve una función para dejar de escuchar — evita acumular listeners entre comandos (half-duplex, uno en vuelo a la vez). */
  onLine(handler: (line: string) => void): () => void;
  close(): Promise<void>;
}

export interface SerialTransportPort {
  list(): Promise<PortInfo[]>;
  open(path: string, baudRate: number): Promise<SerialConnection>;
}
