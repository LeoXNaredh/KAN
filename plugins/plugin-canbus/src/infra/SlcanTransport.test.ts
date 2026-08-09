import type { LineConnectionState, PortInfo, SerialConnection, SerialTransportPort } from "@kan/serial-line-transport";
import { describe, expect, it } from "vitest";
import { SlcanTransport } from "./SlcanTransport";

/**
 * Doble a nivel de puerto serial (no de `CanbusTransportPort`) — simula un
 * adaptador SLCAN real respondiendo el handshake byte a byte, para
 * ejercitar la lógica real de `SlcanTransport` (no un fake que la
 * reemplace). El límite del fake es exactamente el hardware físico, igual
 * que el resto de los transportes "reales" probados contra un servidor de
 * protocolo real hecho a mano en esta sesión (SSH/OPC-UA/SNMP).
 */
class FakeSlcanSerialPort implements SerialTransportPort {
  public readonly written: string[] = [];
  public lastDelimiter: string | undefined;
  private lineHandlers = new Set<(line: string) => void>();

  constructor(private readonly respond: boolean = true) {}

  async list(): Promise<PortInfo[]> {
    return [];
  }

  async open(_path: string, _baudRate: number, delimiter?: string): Promise<SerialConnection> {
    this.lastDelimiter = delimiter;
    let state: LineConnectionState = "connected";

    const connection: SerialConnection = {
      get state() {
        return state;
      },
      write: (line: string) => {
        this.written.push(line);
        if (!this.respond) return;
        // Un adaptador SLCAN real contesta OK con un CR vacío — con el
        // ReadlineParser real (delimiter="\r") eso llega como línea "".
        if (line === "S6" || line === "O" || line === "C") {
          queueMicrotask(() => this.lineHandlers.forEach((handler) => handler("")));
        }
      },
      onLine: (handler: (line: string) => void) => {
        this.lineHandlers.add(handler);
        return () => this.lineHandlers.delete(handler);
      },
      onStateChange: () => () => {},
      close: async () => {
        state = "disconnected";
      },
    };
    return connection;
  }

  /** Simula una trama entrante real de otro nodo del bus, sobre la última conexión abierta. */
  simulateIncomingLine(line: string): void {
    this.lineHandlers.forEach((handler) => handler(line));
  }
}

describe("SlcanTransport (handshake real contra un doble a nivel de puerto serial)", () => {
  it("abre el puerto con delimiter '\\r' — no el '\\n' por defecto del resto de los plugins seriales", async () => {
    const serial = new FakeSlcanSerialPort();
    const transport = new SlcanTransport(serial);

    await transport.openChannel("COM3", 500_000);

    expect(serial.lastDelimiter).toBe("\r");
  });

  it("manda S<n> (bitrate) y después O (abrir canal), en ese orden, antes de cualquier trama", async () => {
    const serial = new FakeSlcanSerialPort();
    const transport = new SlcanTransport(serial);

    await transport.openChannel("COM3", 500_000);

    expect(serial.written).toEqual(["S6", "O"]);
  });

  it("rechaza un bitrate no soportado por SLCAN sin siquiera abrir el puerto", async () => {
    const serial = new FakeSlcanSerialPort();
    const transport = new SlcanTransport(serial);

    await expect(transport.openChannel("COM3", 1_234_567)).rejects.toThrow(/[Bb]itrate/);
    expect(serial.written).toEqual([]);
  });

  it("si el adaptador no responde al handshake, rechaza por timeout en vez de colgarse", async () => {
    const serial = new FakeSlcanSerialPort(false);
    const transport = new SlcanTransport(serial);

    await expect(transport.openChannel("COM3", 500_000)).rejects.toThrow(/timeout|respondió/i);
  }, 2000);

  it("sendFrame manda la trama codificada real con el formato SLCAN exacto", async () => {
    const serial = new FakeSlcanSerialPort();
    const transport = new SlcanTransport(serial);
    const connection = await transport.openChannel("COM3", 500_000);

    await connection.sendFrame({ canId: 0x123, extended: false, data: [0xaa, 0xbb] });

    expect(serial.written).toContain("t1232AABB");
  });

  it("onFrame recibe una trama entrante real decodificada del puerto", async () => {
    const serial = new FakeSlcanSerialPort();
    const transport = new SlcanTransport(serial);
    const connection = await transport.openChannel("COM3", 500_000);

    const received: Array<{ canId: number; extended: boolean; data: number[] }> = [];
    connection.onFrame((frame) => received.push(frame));

    serial.simulateIncomingLine("t1232AABB");

    expect(received).toEqual([{ canId: 0x123, extended: false, data: [0xaa, 0xbb] }]);
  });

  it("close() manda C best-effort y cierra el puerto sin esperar respuesta", async () => {
    const serial = new FakeSlcanSerialPort();
    const transport = new SlcanTransport(serial);
    const connection = await transport.openChannel("COM3", 500_000);

    await connection.close();

    expect(serial.written).toContain("C");
  });
});
