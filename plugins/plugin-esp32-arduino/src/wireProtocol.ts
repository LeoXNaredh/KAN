import type { SerialConnection } from "./SerialTransportPort";

export class SerialTimeoutError extends Error {
  constructor(command: Record<string, unknown>) {
    super(`El dispositivo no respondió a tiempo: ${JSON.stringify(command)}`);
  }
}

/**
 * Protocolo de cable: una línea JSON por comando, una línea JSON de
 * respuesta (ver PROTOCOL.md). Half-duplex por diseño — el driver nunca
 * tiene más de un comando en vuelo por conexión, así que basta con esperar
 * la próxima línea que llegue.
 */
export function sendCommand(
  connection: SerialConnection,
  command: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const unsubscribe = connection.onLine((line) => {
      clearTimeout(timer);
      unsubscribe();
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        reject(new Error(`Respuesta no es JSON válido: ${line}`));
      }
    });

    const timer = setTimeout(() => {
      unsubscribe();
      reject(new SerialTimeoutError(command));
    }, timeoutMs);

    connection.write(JSON.stringify(command));
  });
}
