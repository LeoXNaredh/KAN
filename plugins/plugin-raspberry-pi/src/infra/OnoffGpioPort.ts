import { Gpio } from "onoff";
import type { GpioDirection, GpioLine, GpioPort } from "../GpioPort";

/**
 * Transporte real sobre `onoff` (ADR-038) — lee y escribe directo bajo
 * `/sys/class/gpio`. El paquete en sí es JavaScript puro, pero trae una
 * dependencia transitiva con binding nativo (`epoll`, para interrupciones —
 * no usada acá, ver `apps/desktop/src/main/index.ts` para el import
 * dinámico + try/catch que absorbe un eventual fallo de carga).
 * `Gpio.accessible` detecta si la interfaz sysfs está disponible en este
 * kernel/proceso en vez de fallar en el primer `open()`.
 */
export class OnoffGpioPort implements GpioPort {
  isAccessible(): boolean {
    return Gpio.accessible;
  }

  open(pin: number, direction: GpioDirection): GpioLine {
    const gpio = new Gpio(pin, direction);
    return {
      read: async () => gpio.readSync() === 1,
      write: async (value: boolean) => {
        gpio.writeSync(value ? 1 : 0);
      },
      close: async () => {
        gpio.unexport();
      },
    };
  }
}
