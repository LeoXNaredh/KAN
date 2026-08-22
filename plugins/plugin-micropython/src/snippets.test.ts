import { describe, expect, it } from "vitest";
import { assertValidDevicePath, buildListFilesScript, buildReadFileScript, buildWriteFileScript } from "./snippets";

describe("assertValidDevicePath", () => {
  it("acepta paths simples y con subcarpetas", () => {
    expect(() => assertValidDevicePath("main.py")).not.toThrow();
    expect(() => assertValidDevicePath("lib/util.py")).not.toThrow();
  });

  it.each([["", "vacío"], ["con espacio.py", "espacio"], ["con'comilla.py", "comilla simple"], ['con"comilla.py', "comilla doble"], ["con\\backslash.py", "backslash"]])(
    "rechaza un path %s (%s)",
    (path) => {
      expect(() => assertValidDevicePath(path)).toThrow();
    },
  );
});

describe("buildListFilesScript", () => {
  it("arranca con el marcador #KAN_OP list", () => {
    expect(buildListFilesScript().split("\n")[0]).toBe("#KAN_OP list");
  });
});

describe("buildReadFileScript", () => {
  it("arranca con el marcador #KAN_OP read <path>", () => {
    expect(buildReadFileScript("main.py").split("\n")[0]).toBe("#KAN_OP read main.py");
  });

  it("rechaza un path inválido", () => {
    expect(() => buildReadFileScript("con espacio.py")).toThrow();
  });

  it("usa el path con slash inicial dentro del script real (open())", () => {
    expect(buildReadFileScript("lib/util.py")).toContain("open('/lib/util.py'");
  });
});

describe("buildWriteFileScript", () => {
  it("arranca con el marcador #KAN_OP write <path> <base64>", () => {
    const script = buildWriteFileScript("main.py", "print(1)");
    const expectedBase64 = Buffer.from("print(1)", "utf-8").toString("base64");
    expect(script.split("\n")[0]).toBe(`#KAN_OP write main.py ${expectedBase64}`);
  });

  it("rechaza un path inválido", () => {
    expect(() => buildWriteFileScript("con espacio.py", "x")).toThrow();
  });

  it("crea directorios intermedios antes de escribir", () => {
    const script = buildWriteFileScript("lib/util.py", "x = 1");
    expect(script).toContain("__kan_ensure_dirs('/lib/util.py')");
    expect(script).toContain("open('/lib/util.py'");
  });
});
