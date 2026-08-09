import type { LineConnection, LineConnectionState, NetworkTransportPort } from "@kan/serial-line-transport";

/**
 * Mismo rol que FakeGcodeSerialTransport, para el camino WiFi/TCP — texto
 * G-code plano, no JSON (a diferencia de FakeNetworkTransport de
 * plugin-esp32-arduino).
 */
export interface FakeGcodeNetworkDevice {
  host: string;
  port: number;
  handle(line: string): string[] | undefined;
}

export class FakeGcodeNetworkTransport implements NetworkTransportPort {
  constructor(private readonly devices: FakeGcodeNetworkDevice[]) {}

  async open(host: string, port: number): Promise<LineConnection> {
    const device = this.devices.find((d) => d.host === host && d.port === port);
    if (!device) {
      throw new Error(`No hay nada escuchando en ${host}:${port}`);
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
