import { describe, expect, it } from "vitest";
import { sendGcodeLine, GcodeTimeoutError, ConnectionNotReadyError } from "./gcodeProtocol";
import { FakeGcodeSerialTransport } from "./infra/FakeGcodeSerialTransport";

describe("sendGcodeLine", () => {
  it("resuelve con las líneas de datos recibidas antes del 'ok'", async () => {
    const transport = new FakeGcodeSerialTransport([{ path: "COM1", handle: () => ["X:0.00 Y:0.00", "ok"] }]);
    const connection = await transport.open("COM1", 115200);

    const response = await sendGcodeLine(connection, "M114", 1000);
    expect(response.lines).toEqual(["X:0.00 Y:0.00"]);
  });

  it("resuelve con lines vacío cuando el comando no devuelve datos, solo 'ok'", async () => {
    const transport = new FakeGcodeSerialTransport([{ path: "COM1", handle: () => ["ok"] }]);
    const connection = await transport.open("COM1", 115200);

    const response = await sendGcodeLine(connection, "G28", 1000);
    expect(response.lines).toEqual([]);
  });

  it("rechaza si el firmware responde una línea 'error...'", async () => {
    const transport = new FakeGcodeSerialTransport([{ path: "COM1", handle: () => ["error:Printer halted"] }]);
    const connection = await transport.open("COM1", 115200);

    await expect(sendGcodeLine(connection, "G28", 1000)).rejects.toThrow("error:Printer halted");
  });

  it("agota el timeout si el dispositivo nunca responde, no deja la promesa colgada", async () => {
    const transport = new FakeGcodeSerialTransport([{ path: "COM1", handle: () => undefined }]);
    const connection = await transport.open("COM1", 115200);

    await expect(sendGcodeLine(connection, "G28", 50)).rejects.toThrow(GcodeTimeoutError);
  });

  it("rechaza de inmediato si la conexión no está 'connected', sin esperar el timeout", async () => {
    const transport = new FakeGcodeSerialTransport([{ path: "COM1", handle: () => ["ok"] }]);
    const connection = await transport.open("COM1", 115200);
    await connection.close();

    await expect(sendGcodeLine(connection, "G28", 1000)).rejects.toThrow(ConnectionNotReadyError);
  });
});
