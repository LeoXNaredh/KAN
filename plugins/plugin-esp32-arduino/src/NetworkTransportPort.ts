import type { LineConnection } from "./LineConnection";

export interface TransportOptions {
  /**
   * Reservado para el handshake de autorización TCP — todavía no se usa.
   * Ver PROTOCOL.md "Seguridad (pendiente)" y el TODO en NodeTcpTransport.
   */
  token?: string;
}

/** Mismo protocolo de línea que SerialTransportPort, sobre TCP en vez de un puerto físico. */
export interface NetworkTransportPort {
  open(host: string, port: number, options?: TransportOptions): Promise<LineConnection>;
}
