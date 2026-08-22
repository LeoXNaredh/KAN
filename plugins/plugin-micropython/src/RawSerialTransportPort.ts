export interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export type RawSerialConnectionState = "connected" | "disconnected";

/**
 * Conexión serial a nivel de bytes crudos — a propósito, NO
 * `@kan/serial-line-transport` (`LineConnection`): el raw REPL de
 * MicroPython (Ctrl-A/Ctrl-B/Ctrl-C/Ctrl-D + framing `OK<stdout>\x04<stderr>\x04>`)
 * no es un protocolo línea-por-línea — cualquier byte, incluido `\n`, puede
 * aparecer en medio de una respuesta. Mismo criterio que `ModbusTransportPort`/
 * `OpcuaTransportPort` (plugins/plugin-modbus, plugins/plugin-opcua): cuando
 * el protocolo del dispositivo no encaja en una abstracción compartida, el
 * plugin define la suya, del tamaño exacto que necesita.
 */
export interface RawSerialConnection {
  readonly state: RawSerialConnectionState;
  write(data: Buffer): void;
  /** Devuelve una función para dejar de escuchar. */
  onData(handler: (chunk: Buffer) => void): () => void;
  close(): Promise<void>;
}

export interface RawSerialTransportPort {
  list(): Promise<PortInfo[]>;
  open(path: string, baudRate: number): Promise<RawSerialConnection>;
}
