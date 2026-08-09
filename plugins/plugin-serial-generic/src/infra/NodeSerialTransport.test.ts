import { NodeSerialTransport } from "@kan/serial-line-transport";
import { describe, expect, it } from "vitest";

/**
 * `NodeSerialTransport` (de `@kan/serial-line-transport`) ya tiene
 * cobertura real de hardware serial en su rol de dependencia de
 * `plugin-esp32-arduino`/`plugin-gcode` — no se duplica acá. Esta prueba
 * es más chica: confirma que el transporte real (no un fake) responde de
 * forma correcta y sin colgarse cuando no hay nada conectado, que es
 * exactamente el escenario "sin hardware físico disponible" documentado
 * en el README de este plugin.
 */
describe("NodeSerialTransport (sanity check con el transporte real, sin hardware físico)", () => {
  it("open() sobre un puerto COM inexistente rechaza, no cuelga", async () => {
    const transport = new NodeSerialTransport();
    await expect(transport.open("COM254", 9600)).rejects.toThrow();
  });

  it("list() real no tira, devuelve un array (vacío o con los puertos reales de esta máquina)", async () => {
    const transport = new NodeSerialTransport();
    const ports = await transport.list();
    expect(Array.isArray(ports)).toBe(true);
  });
});
