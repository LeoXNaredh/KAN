import type { ActionSeverity } from "@kan/plugin-contract";

export interface PinInfo {
  pin: number;
}

/**
 * GPIO de propósito general del header de 40 pines, en numeración BCM (la
 * que usa `onoff` y la mayoría del ecosistema Node/Pi — no es la numeración
 * física del header ni WiringPi, ver README).
 *
 * A diferencia de `ESP32_PIN_MAP`, acá no hay pines de solo-lectura — todo
 * GPIO de la Pi es bidireccional. Quedan afuera a propósito los pines que
 * suelen estar reservados por interfaces que muchas Raspberry Pi tienen
 * habilitadas por defecto o vía `raspi-config`: 0/1 (ID EEPROM de HATs),
 * 2/3 (I2C), 7/8/9/10/11 (SPI0), 14/15 (UART) — usarlos a través de este
 * plugin sin querer podría interferir con esas interfaces.
 */
export const RASPBERRY_PI_PIN_MAP: PinInfo[] = [4, 5, 6, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map(
  (pin) => ({ pin }),
);

export function findPin(pin: number): PinInfo | undefined {
  return RASPBERRY_PI_PIN_MAP.find((p) => p.pin === pin);
}

/**
 * Mismo criterio que ESP32/Arduino (regla 8 del sistema de Safety Policy,
 * docs/00): la severidad depende de qué es físicamente posible en el pin,
 * nunca de una suposición sobre qué hay conectado — todo pin escribible
 * arranca `irreversible-material` hasta que el usuario lo reclasifique.
 */
export function defaultSeverityFor(_pin: PinInfo): ActionSeverity {
  return "irreversible-material";
}
