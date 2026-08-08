export type GpioDirection = "in" | "out";

/** Una línea GPIO ya abierta (exportada) — mismo rol que `LineConnection` en `@kan/serial-line-transport`. */
export interface GpioLine {
  read(): Promise<boolean>;
  write(value: boolean): Promise<void>;
  /** Libera el pin (unexport) — no lanza si ya estaba cerrada. */
  close(): Promise<void>;
}

/**
 * Puerto angosto sobre GPIO local (ADR-038) — mismo rol que `SerialTransportPort`
 * para ESP32/Arduino, pero sin conexión ni handshake: el "dispositivo" es la
 * propia máquina donde corre el Edge Agent.
 */
export interface GpioPort {
  /** `false` si el GPIO no es accesible en este proceso (no es una Pi, sin permisos, sysfs no disponible). */
  isAccessible(): boolean;
  open(pin: number, direction: GpioDirection): GpioLine;
}
