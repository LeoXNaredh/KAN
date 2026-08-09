import type { PortInfo, SerialConnection, SerialTransportPort, LineConnectionState } from "@kan/serial-line-transport";

export interface FakePortConfig {
  /** Si es `false`, open() a este puerto falla (simula un puerto inexistente/ocupado). */
  reachable?: boolean;
}

/**
 * Puerto serial simulado en memoria para tests del plugin — nunca usado
 * para probar el transporte real, eso ya lo cubre
 * @kan/serial-line-transport en sus propios tests (ADR-012). Este fake es
 * intencionalmente "tonto": no interpreta ningún protocolo (a diferencia
 * del FakeSerialTransport de plugin-esp32-arduino, que parsea JSON) — un
 * dispositivo serial genérico no tiene un protocolo fijo que simular.
 */
export class FakeSerialTransport implements SerialTransportPort {
  private readonly lineHandlersByPath = new Map<string, Set<(line: string) => void>>();
  public readonly writtenLines: Array<{ path: string; line: string }> = [];

  constructor(private readonly ports: Record<string, FakePortConfig> = {}) {}

  async list(): Promise<PortInfo[]> {
    return Object.keys(this.ports).map((path) => ({ path }));
  }

  async open(path: string): Promise<SerialConnection> {
    if (this.ports[path]?.reachable === false) throw new Error(`No se pudo abrir el puerto: ${path}`);

    if (!this.lineHandlersByPath.has(path)) this.lineHandlersByPath.set(path, new Set());
    const lineHandlers = this.lineHandlersByPath.get(path)!;
    let state: LineConnectionState = "connected";

    return {
      get state() {
        return state;
      },
      write: (line: string) => {
        if (state !== "connected") return;
        this.writtenLines.push({ path, line });
      },
      onLine: (handler: (line: string) => void) => {
        lineHandlers.add(handler);
        return () => lineHandlers.delete(handler);
      },
      onStateChange: () => () => {},
      close: async () => {
        state = "disconnected";
      },
    };
  }

  /** Simula una línea entrante del dispositivo (ej. un sensor publicando por su cuenta) — para tests. */
  simulateIncoming(path: string, line: string): void {
    this.lineHandlersByPath.get(path)?.forEach((handler) => handler(line));
  }
}
