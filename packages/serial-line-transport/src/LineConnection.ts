/**
 * Contrato compartido por cualquier transporte serial línea-por-línea —
 * originalmente extraído de plugin-esp32-arduino, ahora compartido con
 * cualquier plugin que hable un protocolo de texto por líneas sobre un
 * puerto serial (JSON para ESP32, G-code para plugin-gcode). `state` existe
 * para que quien va a mandar un comando sepa si el hardware sigue
 * disponible sin tener que esperar un timeout.
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
