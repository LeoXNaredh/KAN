/**
 * Codec del protocolo SLCAN (a.k.a. Lawicel/CAN232) — texto ASCII sobre un
 * puerto serial, implementado por la inmensa mayoría de adaptadores
 * USB-CAN baratos (CANable, CANtact, USBtin, CANUSB) sin necesitar ningún
 * driver ni binding nativo: el adaptador se enumera como un puerto COM/tty
 * normal y este codec arma/parsea el texto que viaja por ese puerto.
 *
 * Formato verificado contra el código fuente real de python-can
 * (can/interfaces/slcan.py, la implementación de referencia más usada),
 * no contra su documentación (que no detalla el formato de comandos):
 * trama estándar `t<ID 3 hex><DLC 1 decimal><data hex>`, trama extendida
 * `T<ID 8 hex><DLC 1 decimal><data hex>`, terminadas en CR (`\r`), nunca LF.
 */
export interface CanFrame {
  /** ID de 11 bits (estándar, 0x000-0x7FF) o 29 bits (extendida, 0x00000000-0x1FFFFFFF). */
  canId: number;
  extended: boolean;
  /** 0 a 8 bytes — CAN clásico, sin soporte FD (>8 bytes) en este plugin. */
  data: number[];
}

export const SLCAN_ACK = "\r";
/** BEL (0x07) — el adaptador lo manda solo, sin línea completa, cuando un comando falla. */
export const SLCAN_ERROR_BYTE = 0x07;

const STANDARD_ID_MAX = 0x7ff;
const EXTENDED_ID_MAX = 0x1fffffff;
const MAX_DATA_LENGTH = 8;

/** Tabla verificada contra python-can (`_BITRATES` en slcan.py) — único bitrate válido por código S. */
export const SLCAN_BITRATE_TO_CODE: ReadonlyMap<number, string> = new Map([
  [10_000, "S0"],
  [20_000, "S1"],
  [50_000, "S2"],
  [100_000, "S3"],
  [125_000, "S4"],
  [250_000, "S5"],
  [500_000, "S6"],
  [750_000, "S7"],
  [1_000_000, "S8"],
  [83_300, "S9"],
]);

export function bitrateToSlcanCommand(bitrate: number): string | undefined {
  return SLCAN_BITRATE_TO_CODE.get(bitrate);
}

function validateFrame(frame: CanFrame): string | undefined {
  const idMax = frame.extended ? EXTENDED_ID_MAX : STANDARD_ID_MAX;
  if (!Number.isInteger(frame.canId) || frame.canId < 0 || frame.canId > idMax) {
    return `canId fuera de rango para ${frame.extended ? "extendido (29 bits)" : "estándar (11 bits)"}: ${frame.canId}`;
  }
  if (frame.data.length > MAX_DATA_LENGTH) return `data no puede superar ${MAX_DATA_LENGTH} bytes (CAN clásico, sin FD)`;
  if (frame.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) {
    return "cada byte de data debe estar entre 0 y 255";
  }
  return undefined;
}

/** Arma la línea SLCAN para transmitir (sin el CR final — lo agrega el transporte). */
export function encodeFrame(frame: CanFrame): { ok: true; line: string } | { ok: false; error: string } {
  const error = validateFrame(frame);
  if (error) return { ok: false, error };

  const idHex = frame.canId.toString(16).toUpperCase().padStart(frame.extended ? 8 : 3, "0");
  const dlc = frame.data.length.toString(10);
  const dataHex = frame.data.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("");
  const prefix = frame.extended ? "T" : "t";
  return { ok: true, line: `${prefix}${idHex}${dlc}${dataHex}` };
}

/**
 * Parsea una línea recibida del adaptador. Devuelve `undefined` para líneas
 * que no son tramas de datos (ACK vacío, eco de un comando de setup, etc.)
 * — no todas las líneas que manda un adaptador SLCAN son tramas CAN.
 */
export function decodeFrame(line: string): CanFrame | undefined {
  if (line.length === 0) return undefined;
  const prefix = line[0];
  const extended = prefix === "T";
  if (prefix !== "t" && prefix !== "T") return undefined;

  const idLength = extended ? 8 : 3;
  const idHex = line.slice(1, 1 + idLength);
  const dlcChar = line[1 + idLength];
  if (idHex.length !== idLength || dlcChar === undefined) return undefined;

  const canId = Number.parseInt(idHex, 16);
  const dlc = Number.parseInt(dlcChar, 10);
  if (!Number.isInteger(canId) || !Number.isInteger(dlc) || dlc < 0 || dlc > MAX_DATA_LENGTH) return undefined;

  const dataHex = line.slice(2 + idLength, 2 + idLength + dlc * 2);
  if (dataHex.length !== dlc * 2) return undefined;

  const data: number[] = [];
  for (let i = 0; i < dataHex.length; i += 2) {
    const byte = Number.parseInt(dataHex.slice(i, i + 2), 16);
    if (!Number.isInteger(byte)) return undefined;
    data.push(byte);
  }

  return { canId, extended, data };
}
