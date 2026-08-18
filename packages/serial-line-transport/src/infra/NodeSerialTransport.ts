import { SerialPort, ReadlineParser } from "serialport";
import type { PortInfo, SerialConnection, SerialTransportPort } from "../SerialTransportPort";
import type { LineConnectionState } from "../LineConnection";

/**
 * Transporte serial real sobre `serialport` (recomendado en docs/08 §3).
 *
 * Sin reconexión automática (a diferencia de NodeTcpTransport) — una
 * desconexión de un puerto serial (cable desenchufado) normalmente implica
 * que el dispositivo físico ya no está ahí, no tiene sentido reintentar
 * como sí lo tiene una caída de WiFi transitoria.
 */
export class NodeSerialTransport implements SerialTransportPort {
  async list(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      vendorId: port.vendorId,
      productId: port.productId,
    }));
  }

  async open(path: string, baudRate: number, delimiter = "\n"): Promise<SerialConnection> {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter }));

    await new Promise<void>((resolve, reject) => {
      port.open((error) => (error ? reject(error) : resolve()));
    });

    let state: LineConnectionState = "connected";
    const stateHandlers: Array<(state: LineConnectionState) => void> = [];
    const setState = (next: LineConnectionState) => {
      if (state === next) return;
      state = next;
      stateHandlers.forEach((handler) => handler(state));
    };

    port.on("close", () => setState("disconnected"));
    port.on("error", () => setState("disconnected"));

    return {
      get state() {
        return state;
      },
      write: (line: string) => {
        port.write(`${line}${delimiter}`);
      },
      onLine: (handler: (line: string) => void) => {
        const listener = (line: string) => handler(line);
        parser.on("data", listener);
        return () => {
          parser.off("data", listener);
        };
      },
      onStateChange: (handler: (state: LineConnectionState) => void) => {
        stateHandlers.push(handler);
        return () => {
          const index = stateHandlers.indexOf(handler);
          if (index !== -1) stateHandlers.splice(index, 1);
        };
      },
      close: () =>
        new Promise<void>((resolve, reject) => {
          if (!port.isOpen) {
            setState("disconnected");
            resolve();
            return;
          }
          port.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            setState("disconnected");
            resolve();
          });
        }),
    };
  }
}
