import type { LineConnection, LineConnectionState } from "../LineConnection";
import type { NetworkTransportPort } from "../NetworkTransportPort";

/**
 * Transporte de red simulado para tests del plugin (mismo rol que
 * FakeSerialTransport para el camino Serial) — la resiliencia real
 * (reconexión/backoff) se prueba aparte contra un servidor TCP real en
 * NodeTcpTransport.test.ts (ADR-012); esto es solo para probar
 * discover()/connect()/invoke() del plugin sobre WiFi sin red real.
 */
export interface FakeNetworkDevice {
  host: string;
  port: number;
  handle(command: Record<string, unknown>): Record<string, unknown> | undefined;
}

export class FakeNetworkTransport implements NetworkTransportPort {
  constructor(private readonly devices: FakeNetworkDevice[]) {}

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
        let command: Record<string, unknown>;
        try {
          command = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        const response = device.handle(command);
        if (response !== undefined) {
          queueMicrotask(() => {
            if (state !== "connected") return;
            lineHandlers.forEach((handler) => handler(JSON.stringify(response)));
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
