import type { LineConnection } from "@kan/serial-line-transport";

export class GcodeTimeoutError extends Error {
  constructor(line: string) {
    super(`El dispositivo no respondió a tiempo: ${line}`);
  }
}

export class ConnectionNotReadyError extends Error {
  constructor(state: string) {
    super(`No se puede enviar el comando: la conexión está "${state}"`);
  }
}

export interface GcodeResponse {
  /** Líneas recibidas antes del "ok" final (ej. la posición que devuelve M114) — vacío si el comando no devuelve datos. */
  lines: string[];
}

const OK_PATTERN = /^ok\b/i;
const ERROR_PATTERN = /^error/i;

/**
 * Protocolo de cable G-code: una línea de comando, cero o más líneas de
 * datos, una línea final "ok" (éxito) o que empieza con "error" (fallo) —
 * convención compartida por Marlin y GRBL. No modela checksums ni
 * numeración de línea (M110/prefijos N) — alcance v1 deliberado, ver
 * README.md.
 *
 * Half-duplex por diseño, mismo criterio que wireProtocol.ts en
 * plugin-esp32-arduino: nunca hay más de un comando en vuelo por conexión.
 * Rechaza de inmediato si la conexión no está "connected".
 */
export function sendGcodeLine(connection: LineConnection, line: string, timeoutMs: number): Promise<GcodeResponse> {
  if (connection.state !== "connected") {
    return Promise.reject(new ConnectionNotReadyError(connection.state));
  }

  return new Promise((resolve, reject) => {
    const collected: string[] = [];

    const unsubscribe = connection.onLine((received) => {
      if (ERROR_PATTERN.test(received)) {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(received));
        return;
      }
      if (OK_PATTERN.test(received)) {
        clearTimeout(timer);
        unsubscribe();
        resolve({ lines: collected });
        return;
      }
      collected.push(received);
    });

    const timer = setTimeout(() => {
      unsubscribe();
      reject(new GcodeTimeoutError(line));
    }, timeoutMs);

    connection.write(line);
  });
}
