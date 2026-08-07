/**
 * Contrato compartido por cualquier transporte que hable el protocolo de
 * línea JSON (PROTOCOL.md) — Serial y WiFi hoy, cualquier otro mañana.
 * `state` existe para que quien va a mandar un comando (wireProtocol.ts)
 * sepa si el hardware sigue disponible sin tener que esperar un timeout.
 */
export type LineConnectionState = "connected" | "reconnecting" | "disconnected";

export interface LineConnection {
  readonly state: LineConnectionState;
  write(line: string): void;
  /** Devuelve una función para dejar de escuchar. */
  onLine(handler: (line: string) => void): () => void;
  onStateChange(handler: (state: LineConnectionState) => void): () => void;
  close(): Promise<void>;
}
