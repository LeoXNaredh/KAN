import { NodeSerialTransport, type SerialConnection, type SerialTransportPort } from "@kan/serial-line-transport";
import type { CanbusConnection, CanbusTransportPort } from "../CanbusTransportPort";
import { bitrateToSlcanCommand, decodeFrame, encodeFrame, type CanFrame } from "../SlcanCodec";

/** SLCAN termina cada comando/trama en CR (`\r`), nunca en `\n` — a diferencia de todo lo demás que habla @kan/serial-line-transport (JSON de ESP32, G-code, serial genérico). */
const SLCAN_LINE_DELIMITER = "\r";
const HANDSHAKE_TIMEOUT_MS = 1000;
/**
 * Baud rate del enlace USB-serial en sí (no confundir con el bitrate del
 * bus CAN, que se fija después con el comando `S<n>`) — 115200 es el valor
 * casi universal en adaptadores SLCAN/CANable, muy por encima de lo que
 * el link USB-serial necesita transmitir tramas CAN de a lo sumo 8 bytes.
 */
const USB_SERIAL_BAUD_RATE = 115_200;

/**
 * Transporte real sobre `@kan/serial-line-transport` — un adaptador SLCAN
 * se enumera como un puerto COM/tty normal, sin ningún binding nativo
 * propio: este transporte solo agrega el handshake y el framing SLCAN
 * (`SlcanCodec`) encima del mismo transporte serial ya usado por
 * plugin-esp32-arduino/plugin-gcode/plugin-serial-generic.
 *
 * Secuencia de arranque: fijar el bitrate (`S<n>`, el bus debe estar
 * cerrado) y después abrir el canal (`O`). No se manda `C` (cerrar canal)
 * al arrancar — la mayoría de firmwares SLCAN arrancan con el canal ya
 * cerrado, y la señalización de error de `C` sobre un canal ya cerrado
 * (BEL sin CR en algunos firmwares) es ambigua de distinguir de forma
 * genérica con un parser de líneas — se documenta como limitación conocida
 * en el README, no se esconde.
 */
export class SlcanTransport implements CanbusTransportPort {
  constructor(private readonly serial: SerialTransportPort = new NodeSerialTransport()) {}

  async openChannel(path: string, bitrate: number): Promise<CanbusConnection> {
    const bitrateCommand = bitrateToSlcanCommand(bitrate);
    if (!bitrateCommand) throw new Error(`Bitrate no soportado por SLCAN: ${bitrate}`);

    const connection = await this.serial.open(path, USB_SERIAL_BAUD_RATE, SLCAN_LINE_DELIMITER);

    try {
      await this.waitForResponse(connection, () => connection.write(bitrateCommand));
      await this.waitForResponse(connection, () => connection.write("O"));
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }

    const frameHandlers = new Set<(frame: CanFrame) => void>();
    const unsubscribeLine = connection.onLine((line) => {
      const frame = decodeFrame(line);
      if (frame) frameHandlers.forEach((handler) => handler(frame));
    });

    return {
      sendFrame: async (frame: CanFrame) => {
        const encoded = encodeFrame(frame);
        if (!encoded.ok) throw new Error(encoded.error);
        connection.write(encoded.line);
      },
      onFrame: (handler) => {
        frameHandlers.add(handler);
        return () => frameHandlers.delete(handler);
      },
      close: async () => {
        unsubscribeLine();
        connection.write("C"); // best-effort, no se espera respuesta
        await connection.close();
      },
    };
  }

  private waitForResponse(connection: SerialConnection, send: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("El adaptador CAN no respondió al handshake SLCAN (timeout)"));
      }, HANDSHAKE_TIMEOUT_MS);

      const unsubscribe = connection.onLine(() => {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });

      send();
    });
  }
}
