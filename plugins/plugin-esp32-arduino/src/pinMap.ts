import type { ActionSeverity } from "@kan/plugin-contract";

export interface PinInfo {
  pin: number;
  canWrite: boolean;
  canAnalogWrite: boolean;
}

const WRITE_CAPABLE_PINS = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
/** 34/35/36/39 en un ESP32 DevKit no tienen driver de salida en el silicio: solo-entrada siempre. */
const INPUT_ONLY_PINS = [34, 35, 36, 39];

export const ESP32_PIN_MAP: PinInfo[] = [
  ...WRITE_CAPABLE_PINS.map((pin) => ({ pin, canWrite: true, canAnalogWrite: true })),
  ...INPUT_ONLY_PINS.map((pin) => ({ pin, canWrite: false, canAnalogWrite: false })),
];

export function findPin(pin: number): PinInfo | undefined {
  return ESP32_PIN_MAP.find((p) => p.pin === pin);
}

/**
 * El default nunca lo decide el plugin en base a qué asume que hay
 * conectado — solo en base a qué es físicamente posible en ese pin (regla 8
 * del sistema de Safety Policy). Un pin capaz de escribir es
 * `irreversible-material` por defecto hasta que el usuario lo reclasifique
 * explícitamente vía Safety Policy.
 */
export function defaultSeverityFor(pin: PinInfo): ActionSeverity {
  return pin.canWrite ? "irreversible-material" : "read-only";
}
