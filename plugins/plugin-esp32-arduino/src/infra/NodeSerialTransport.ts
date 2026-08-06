import { SerialPort, ReadlineParser } from "serialport";
import type { PortInfo, SerialConnection, SerialTransportPort } from "../SerialTransportPort";

/**
 * Transporte serial real sobre `serialport` (recomendado en docs/08 §3).
 * No hay hardware disponible para probarlo en esta sesión — queda listo
 * para que el usuario lo use al flashear un ESP32/Arduino real.
 */
export class NodeSerialTransport implements SerialTransportPort {
  async list(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map((port) => ({ path: port.path, manufacturer: port.manufacturer }));
  }

  async open(path: string, baudRate: number): Promise<SerialConnection> {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    await new Promise<void>((resolve, reject) => {
      port.open((error) => (error ? reject(error) : resolve()));
    });

    return {
      write: (line: string) => {
        port.write(`${line}\n`);
      },
      onLine: (handler: (line: string) => void) => {
        const listener = (line: string) => handler(line);
        parser.on("data", listener);
        return () => {
          parser.off("data", listener);
        };
      },
      close: () =>
        new Promise<void>((resolve, reject) => {
          if (!port.isOpen) {
            resolve();
            return;
          }
          port.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  }
}
