import type { GpioDirection, GpioLine, GpioPort } from "../GpioPort";

/**
 * GPIO simulado para tests (ADR-012/ADR-038) — mismo criterio que
 * `FakeSerialTransport` en ESP32/Arduino: reemplaza el hardware físico, no
 * la lógica del plugin. `openedPins`/`closedPins` quedan expuestos para que
 * los tests verifiquen que `disconnect()` realmente libera lo que abrió.
 */
export class FakeGpioPort implements GpioPort {
  readonly openedPins: number[] = [];
  readonly closedPins: number[] = [];
  private readonly values = new Map<number, boolean>();

  constructor(private readonly accessible: boolean = true) {}

  isAccessible(): boolean {
    return this.accessible;
  }

  open(pin: number, _direction: GpioDirection): GpioLine {
    this.openedPins.push(pin);
    if (!this.values.has(pin)) this.values.set(pin, false);

    return {
      read: async () => this.values.get(pin) ?? false,
      write: async (value: boolean) => {
        this.values.set(pin, value);
      },
      close: async () => {
        this.closedPins.push(pin);
      },
    };
  }

  /** Simula un cambio de estado externo del pin (ej. un sensor conectado), para tests de lectura. */
  setValue(pin: number, value: boolean): void {
    this.values.set(pin, value);
  }
}
