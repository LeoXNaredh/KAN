import { describe, expect, it } from "vitest";
import { FakeMicroPythonDevice, FakeRawSerialTransport } from "./infra/FakeRawSerialTransport";
import { enterRawRepl, RawReplExecError, RawReplTimeoutError } from "./rawRepl";
import { buildListFilesScript, buildReadFileScript, buildWriteFileScript } from "./snippets";

const TIMEOUT_MS = 1000;

describe("enterRawRepl", () => {
  it("entra a raw REPL contra un device que responde el banner", async () => {
    const transport = new FakeRawSerialTransport([new FakeMicroPythonDevice("COM3")]);
    const connection = await transport.open("COM3", 115200);

    const session = await enterRawRepl(connection, TIMEOUT_MS);

    expect(session).toBeTruthy();
    session.dispose();
  });

  it("lanza RawReplTimeoutError si el device nunca responde (no es MicroPython)", async () => {
    const transport = new FakeRawSerialTransport([{ path: "COM4", handle: () => undefined }]);
    const connection = await transport.open("COM4", 115200);

    await expect(enterRawRepl(connection, 100)).rejects.toThrow(RawReplTimeoutError);
  });
});

describe("RawReplSession.exec", () => {
  it("ejecuta un script list y devuelve el stdout", async () => {
    const transport = new FakeRawSerialTransport([
      new FakeMicroPythonDevice("COM3", { "main.py": "print(1)", "lib/util.py": "x = 1" }),
    ]);
    const connection = await transport.open("COM3", 115200);
    const session = await enterRawRepl(connection, TIMEOUT_MS);

    const stdout = await session.exec(buildListFilesScript(), TIMEOUT_MS);

    const lines = stdout.toString("utf-8").split("\n").sort();
    expect(lines).toEqual(["lib/util.py 5", "main.py 8"]);
    session.dispose();
  });

  it("ejecuta un script read y devuelve el contenido en base64", async () => {
    const transport = new FakeRawSerialTransport([new FakeMicroPythonDevice("COM3", { "main.py": "print(1)" })]);
    const connection = await transport.open("COM3", 115200);
    const session = await enterRawRepl(connection, TIMEOUT_MS);

    const stdout = await session.exec(buildReadFileScript("main.py"), TIMEOUT_MS);

    expect(Buffer.from(stdout.toString("utf-8"), "base64").toString("utf-8")).toBe("print(1)");
    session.dispose();
  });

  it("lanza RawReplExecError con el stderr si el archivo no existe", async () => {
    const transport = new FakeRawSerialTransport([new FakeMicroPythonDevice("COM3", {})]);
    const connection = await transport.open("COM3", 115200);
    const session = await enterRawRepl(connection, TIMEOUT_MS);

    await expect(session.exec(buildReadFileScript("no-existe.py"), TIMEOUT_MS)).rejects.toThrow(RawReplExecError);
    session.dispose();
  });

  it("ejecuta un script write y el archivo queda guardado en el device", async () => {
    const device = new FakeMicroPythonDevice("COM3", {});
    const transport = new FakeRawSerialTransport([device]);
    const connection = await transport.open("COM3", 115200);
    const session = await enterRawRepl(connection, TIMEOUT_MS);

    await session.exec(buildWriteFileScript("main.py", "print('hola')"), TIMEOUT_MS);

    expect(device.readFileSync("main.py")).toBe("print('hola')");
    session.dispose();
  });

  it("permite varios exec() seguidos en la misma sesión raw REPL", async () => {
    const device = new FakeMicroPythonDevice("COM3", {});
    const transport = new FakeRawSerialTransport([device]);
    const connection = await transport.open("COM3", 115200);
    const session = await enterRawRepl(connection, TIMEOUT_MS);

    await session.exec(buildWriteFileScript("a.py", "1"), TIMEOUT_MS);
    await session.exec(buildWriteFileScript("b.py", "2"), TIMEOUT_MS);
    const stdout = await session.exec(buildListFilesScript(), TIMEOUT_MS);

    expect(stdout.toString("utf-8").split("\n").sort()).toEqual(["a.py 1", "b.py 1"]);
    session.dispose();
  });
});

describe("RawReplSession.exit", () => {
  it("manda Ctrl-B para volver a la REPL amigable", async () => {
    const device = new FakeMicroPythonDevice("COM3", {});
    const transport = new FakeRawSerialTransport([device]);
    const connection = await transport.open("COM3", 115200);
    const session = await enterRawRepl(connection, TIMEOUT_MS);

    let lastChunk: Buffer | undefined;
    connection.onData((chunk) => {
      lastChunk = chunk;
    });
    session.exit();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(lastChunk?.toString("utf-8")).toContain(">>>");
    session.dispose();
  });
});
