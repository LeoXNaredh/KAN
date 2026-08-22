import { SerialPort } from "serialport";
import type { PortInfo, RawSerialConnection, RawSerialConnectionState, RawSerialTransportPort } from "../RawSerialTransportPort";

/**
 * Transporte serial real a nivel de bytes, sobre `serialport` directo — sin
 * `ReadlineParser` (a diferencia de `NodeSerialTransport` de
 * `@kan/serial-line-transport`): el raw REPL necesita ver cada byte tal cual
 * llega, no partido por línea.
 */
export class NodeRawSerialTransport implements RawSerialTransportPort {
  async list(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      vendorId: port.vendorId,
      productId: port.productId,
    }));
  }

  async open(path: string, baudRate: number): Promise<RawSerialConnection> {
    const port = new SerialPort({ path, baudRate, autoOpen: false });

    await new Promise<void>((resolve, reject) => {
      port.open((error) => (error ? reject(error) : resolve()));
    });

    let state: RawSerialConnectionState = "connected";
    const dataHandlers = new Set<(chunk: Buffer) => void>();
    port.on("data", (chunk: Buffer) => {
      for (const handler of dataHandlers) handler(chunk);
    });
    port.on("close", () => {
      state = "disconnected";
    });
    port.on("error", () => {
      state = "disconnected";
    });

    return {
      get state() {
        return state;
      },
      write: (data: Buffer) => {
        port.write(data);
      },
      onData: (handler: (chunk: Buffer) => void) => {
        dataHandlers.add(handler);
        return () => dataHandlers.delete(handler);
      },
      close: () =>
        new Promise<void>((resolve, reject) => {
          if (!port.isOpen) {
            state = "disconnected";
            resolve();
            return;
          }
          port.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            state = "disconnected";
            resolve();
          });
        }),
    };
  }
}
