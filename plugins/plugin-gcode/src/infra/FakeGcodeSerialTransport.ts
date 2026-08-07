import type { PortInfo, SerialConnection, SerialTransportPort, LineConnectionState } from "@kan/serial-line-transport";

/**
 * Firmware G-code simulado para tests (ADR-012: probar contra un "cliente
 * real" — un dispositivo que habla el protocolo de verdad — en vez de
 * mockear la lógica interna). Mismo rol que FakeSerialTransport en
 * plugin-esp32-arduino, adaptado a texto plano en vez de JSON.
 */
export interface FakeGcodeDevice {
  path: string;
  manufacturer?: string;
  /** Decide qué línea(s) responder a cada línea recibida — `undefined` simula un dispositivo que no responde (colgado o ajeno). */
  handle(line: string): string[] | undefined;
}

export class FakeGcodeSerialTransport implements SerialTransportPort {
  constructor(private readonly devices: FakeGcodeDevice[]) {}

  async list(): Promise<PortInfo[]> {
    return this.devices.map((device) => ({ path: device.path, manufacturer: device.manufacturer }));
  }

  async open(path: string, _baudRate?: number): Promise<SerialConnection> {
    const device = this.devices.find((d) => d.path === path);
    if (!device) {
      throw new Error(`Puerto no encontrado: ${path}`);
    }

    const lineHandlers: Array<(line: string) => void> = [];
    const stateHandlers: Array<(state: LineConnectionState) => void> = [];
    let state: LineConnectionState = "connected";

    return {
      get state() {
        return state;
      },
      write: (line: string) => {
        if (state !== "connected") return;
        const responseLines = device.handle(line);
        if (responseLines !== undefined) {
          queueMicrotask(() => {
            if (state !== "connected") return;
            responseLines.forEach((responseLine) => lineHandlers.forEach((handler) => handler(responseLine)));
          });
        }
      },
      onLine: (handler: (line: string) => void) => {
        lineHandlers.push(handler);
        return () => {
          const index = lineHandlers.indexOf(handler);
          if (index !== -1) lineHandlers.splice(index, 1);
        };
      },
      onStateChange: (handler: (state: LineConnectionState) => void) => {
        stateHandlers.push(handler);
        return () => {
          const index = stateHandlers.indexOf(handler);
          if (index !== -1) stateHandlers.splice(index, 1);
        };
      },
      close: async () => {
        state = "disconnected";
        stateHandlers.forEach((handler) => handler(state));
      },
    };
  }
}
