import { ServerTCP } from "modbus-serial";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NodeModbusTransport } from "./NodeModbusTransport";

/**
 * Contra un ServerTCP real (Modbus TCP), no un mock del transporte
 * (ADR-012). RTU serial real (`rtu-serial`) queda sin probar contra
 * hardware en esta sesión — sin un puerto serial/RS-485 físico ni un par
 * de puertos COM virtuales disponibles en este entorno Windows, mismo caso
 * ya documentado en plugin-esp32-arduino/plugin-gcode. Cubierto solo por
 * los tests unitarios con FakeModbusTransport.
 */
describe("NodeModbusTransport (integración contra un ServerTCP real)", () => {
  let server: ServerTCP;
  const port = 15502;
  const holdingRegisters: Record<number, number> = { 100: 42, 101: 43 };
  const coils: Record<number, boolean> = { 5: true };

  beforeAll(async () => {
    server = new ServerTCP(
      {
        getHoldingRegister: (addr: number) => holdingRegisters[addr] ?? 0,
        getInputRegister: () => 0,
        getCoil: (addr: number) => coils[addr] ?? false,
        getDiscreteInput: () => false,
        setRegister: (addr: number, value: number) => {
          holdingRegisters[addr] = value;
        },
        setCoil: (addr: number, value: boolean) => {
          coils[addr] = value;
        },
      },
      { host: "127.0.0.1", port, unitID: 1 },
    );
    await new Promise<void>((resolve) => server.on("initialized", () => resolve()));
  });

  afterAll(() => {
    server.close(() => {});
  });

  it("readHoldingRegisters real trae los valores servidos", async () => {
    const transport = new NodeModbusTransport();
    const connection = await transport.connect({ kind: "tcp", host: "127.0.0.1", port });
    const values = await connection.readHoldingRegisters(1, 100, 2);
    expect(values).toEqual([42, 43]);
    await connection.close();
  });

  it("writeRegister real persiste, confirmado con una lectura posterior", async () => {
    const transport = new NodeModbusTransport();
    const connection = await transport.connect({ kind: "tcp", host: "127.0.0.1", port });
    await connection.writeRegister(1, 200, 777);
    const values = await connection.readHoldingRegisters(1, 200, 1);
    expect(values).toEqual([777]);
    await connection.close();
  });

  it("readCoils/writeCoil reales funcionan de punta a punta, recortados a la cantidad pedida", async () => {
    const transport = new NodeModbusTransport();
    const connection = await transport.connect({ kind: "tcp", host: "127.0.0.1", port });
    // El wire protocol devuelve el byte entero (8 bits) — confirma que el
    // wrapper lo recorta a 1 elemento, no que el servidor solo tiene 1 bit.
    expect(await connection.readCoils(1, 5, 1)).toEqual([true]);
    await connection.writeCoil(1, 6, true);
    expect(await connection.readCoils(1, 6, 1)).toEqual([true]);
    await connection.close();
  });

  it("connect() a un puerto sin nada escuchando rechaza, no cuelga", async () => {
    const transport = new NodeModbusTransport();
    await expect(transport.connect({ kind: "tcp", host: "127.0.0.1", port: 1 }, { connectTimeoutMs: 500 })).rejects.toThrow();
  });
});
