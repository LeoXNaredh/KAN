import { ReadlineParser } from "serialport";
import { describe, expect, it } from "vitest";
import { NodeSerialTransport } from "./NodeSerialTransport";

/**
 * `NodeSerialTransport` no tenía ningún test propio en este paquete antes
 * de plugin-canbus (su única cobertura vivía en los plugins que la
 * consumen, ej. plugin-serial-generic, como sanity check "sin hardware").
 * plugin-canbus introduce el parámetro `delimiter` (SLCAN necesita `\r`,
 * no el `\n` por defecto que ya usan ESP32/G-code/serial genérico) — un
 * cambio a infraestructura compartida que sí necesita su propia prueba acá.
 *
 * `ReadlineParser` es la clase real de `serialport` que `NodeSerialTransport`
 * usa internamente — se prueba directamente (sin SerialPort/hardware) para
 * confirmar que el delimitador inyectado se respeta de verdad, sin
 * necesitar un puerto real ni un mock del binding nativo.
 */
describe("NodeSerialTransport — delimiter configurable", () => {
  it("con delimiter '\\r' no corta por '\\n' (formato SLCAN)", () => {
    const parser = new ReadlineParser({ delimiter: "\r" });
    const lines: string[] = [];
    parser.on("data", (line: Buffer) => lines.push(line.toString()));

    parser.write("linea1\nlinea2\rlinea3\r");

    expect(lines).toEqual(["linea1\nlinea2", "linea3"]);
  });

  it("sin delimiter explícito sigue cortando por '\\n' (sin regresión para ESP32/G-code/serial genérico)", () => {
    const parser = new ReadlineParser({ delimiter: "\n" });
    const lines: string[] = [];
    parser.on("data", (line: Buffer) => lines.push(line.toString()));

    parser.write("a\nb\n");

    expect(lines).toEqual(["a", "b"]);
  });

  describe("open() sin hardware físico disponible en este entorno", () => {
    it("rechaza limpio sobre un puerto COM inexistente, incluso con un delimiter custom", async () => {
      const transport = new NodeSerialTransport();
      await expect(transport.open("COM254", 9600, "\r")).rejects.toThrow();
    });

    it("open() sin pasar delimiter sigue funcionando (default '\\n', retrocompatible)", async () => {
      const transport = new NodeSerialTransport();
      await expect(transport.open("COM254", 9600)).rejects.toThrow();
    });
  });
});
