import type { LineConnection } from "./LineConnection";

export class SerialTimeoutError extends Error {
  constructor(command: Record<string, unknown>) {
    super(`El dispositivo no respondió a tiempo: ${JSON.stringify(command)}`);
  }
}

export class ConnectionNotReadyError extends Error {
  constructor(state: string) {
    super(`No se puede enviar el comando: la conexión está "${state}"`);
  }
}

/**
 * Protocolo de cable: una línea JSON por comando, una línea JSON de
 * respuesta (ver PROTOCOL.md). Half-duplex por diseño — el driver nunca
 * tiene más de un comando en vuelo por conexión, así que basta con esperar
 * la próxima línea que llegue.
 *
 * Rechaza de inmediato si la conexión no está "connected" — el Core sabe
 * que el hardware no está disponible sin tener que esperar el timeout.
 */
export function sendCommand(
  connection: LineConnection,
  command: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  if (connection.state !== "connected") {
    return Promise.reject(new ConnectionNotReadyError(connection.state));
  }

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
