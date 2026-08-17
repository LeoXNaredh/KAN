import { existsSync, readFileSync } from "node:fs";
import { Gpio } from "onoff";
import type { GpioDirection, GpioLine, GpioPort } from "../GpioPort";

const SYSFS_GPIO_ROOT = "/sys/class/gpio";

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

  /** `onoff` no expone lectura de un pin ya exportado sin reclamarlo — se lee `/sys/class/gpio` directo, que sí lo soporta (ver `GpioPort.peek`). */
  peek(pin: number): { direction: GpioDirection; value: boolean } | undefined {
    const base = `${SYSFS_GPIO_ROOT}/gpio${pin}`;
    if (!existsSync(base)) return undefined;
    try {
      const direction = readFileSync(`${base}/direction`, "utf8").trim();
      const value = readFileSync(`${base}/value`, "utf8").trim();
      return { direction: direction === "out" ? "out" : "in", value: value === "1" };
    } catch {
      return undefined;
    }
  }
}
