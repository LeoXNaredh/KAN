import { createSocket, type Socket } from "node:dgram";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NodeWolTransport } from "./NodeWolTransport";

/**
 * Contra un socket UDP real escuchando en loopback, no un mock (ADR-012).
 * No es broadcast real de LAN (no viable/deseable en tests automatizados),
 * pero sí un envío UDP real por la red del sistema operativo — confirma
 * que el transporte arma bytes válidos y los manda de verdad, no solo en
 * memoria.
 */
describe("NodeWolTransport (integración real contra un socket UDP)", () => {
  let listener: Socket;
  let port: number;
  let lastPacket: Buffer | undefined;

  beforeAll(async () => {
    listener = createSocket("udp4");
    listener.on("message", (msg) => {
      lastPacket = msg;
    });
    await new Promise<void>((resolve) => listener.bind(0, "127.0.0.1", resolve));
    const address = listener.address();
    port = address.port;
  });

  afterAll(() => {
    listener.close();
  });

  it("sendMagicPacket real llega al socket con el formato correcto (6xFF + MAC x16)", async () => {
    const transport = new NodeWolTransport();
    await transport.sendMagicPacket("AA:BB:CC:DD:EE:FF", "127.0.0.1", port);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(lastPacket).toBeDefined();
    expect(lastPacket!.length).toBe(102);
    for (let i = 0; i < 6; i++) expect(lastPacket![i]).toBe(0xff);
    expect(Array.from(lastPacket!.subarray(6, 12))).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });

  it("sendMagicPacket rechaza una MAC inválida sin llegar a mandar nada", async () => {
    const transport = new NodeWolTransport();
    await expect(transport.sendMagicPacket("no-es-una-mac", "127.0.0.1", port)).rejects.toThrow(/MAC address inválida/);
  });
});
