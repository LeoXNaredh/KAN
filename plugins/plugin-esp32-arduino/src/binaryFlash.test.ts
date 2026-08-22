import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readFlashImage, resolveFlashToolConfig, writeFlashImage } from "./binaryFlash";
import { FakeExternalProcess } from "./infra/FakeExternalProcess";

const TIMEOUT_MS = 5000;

describe("readFlashImage", () => {
  it("con tool 'esptool', invoca esptool.py read_flash y devuelve lo que escribió en el archivo temporal", async () => {
    const image = Buffer.from([1, 2, 3, 4]);
    const externalProcess = new FakeExternalProcess(async (call) => {
      const outputPath = call.args[call.args.length - 1];
      await writeFile(outputPath, image);
      return { exitCode: 0, stderr: "" };
    });

    const result = await readFlashImage(externalProcess, { tool: "esptool", port: "COM3", timeoutMs: TIMEOUT_MS, chip: "esp32" });

    expect(result.equals(image)).toBe(true);
    expect(externalProcess.calls).toHaveLength(1);
    expect(externalProcess.calls[0].command).toBe("esptool.py");
    expect(externalProcess.calls[0].args.slice(0, -1)).toEqual(["--chip", "esp32", "--port", "COM3", "read_flash", "0x0", "0x400000"]);
  });

  it("con tool 'avrdude', invoca avrdude con -U flash:r:<archivo>:raw", async () => {
    const image = Buffer.from([9, 9]);
    const externalProcess = new FakeExternalProcess(async (call) => {
      const uArgIndex = call.args.indexOf("-U");
      const memoryOp = call.args[uArgIndex + 1]; // "flash:r:<path>:raw" — el path puede tener ':' propio en Windows (ej. "C:\..."), no separar con un split(":") ingenuo.
      const outputPath = memoryOp.slice("flash:r:".length, -":raw".length);
      await writeFile(outputPath, image);
      return { exitCode: 0, stderr: "" };
    });

    const result = await readFlashImage(externalProcess, { tool: "avrdude", port: "COM4", timeoutMs: TIMEOUT_MS });

    expect(result.equals(image)).toBe(true);
    expect(externalProcess.calls[0].command).toBe("avrdude");
    expect(externalProcess.calls[0].args).toEqual([
      "-c",
      "arduino",
      "-p",
      "atmega328p",
      "-P",
      "COM4",
      "-b",
      "115200",
      "-U",
      expect.stringMatching(/^flash:r:.+:raw$/),
    ]);
  });

  it("propaga el error si esptool.py falla (ej. no instalado)", async () => {
    const externalProcess = new FakeExternalProcess(() => ({ exitCode: null, stderr: "Comando no encontrado" }));

    await expect(readFlashImage(externalProcess, { tool: "esptool", port: "COM3", timeoutMs: TIMEOUT_MS })).rejects.toThrow(
      /Comando no encontrado/,
    );
  });

  it("respeta chip/flashSizeBytes configurados", async () => {
    const externalProcess = new FakeExternalProcess(async (call) => {
      await writeFile(call.args[call.args.length - 1], Buffer.alloc(0));
      return { exitCode: 0, stderr: "" };
    });

    await readFlashImage(externalProcess, {
      tool: "esptool",
      port: "COM3",
      timeoutMs: TIMEOUT_MS,
      chip: "esp32s3",
      flashSizeBytes: 8 * 1024 * 1024,
    });

    expect(externalProcess.calls[0].args).toContain("esp32s3");
    expect(externalProcess.calls[0].args).toContain("0x800000");
  });
});

describe("writeFlashImage", () => {
  it("con tool 'esptool', escribe el buffer a un archivo temporal y lo pasa a write_flash", async () => {
    const image = Buffer.from([5, 6, 7]);
    let writtenToDisk: Buffer | undefined;
    const externalProcess = new FakeExternalProcess(async (call) => {
      const filePath = call.args[call.args.length - 1];
      // Leído DENTRO del handler, antes de que `withTempImageFile` borre el
      // directorio temporal al volver — leerlo después de este `run()`
      // sería una carrera contra esa limpieza.
      writtenToDisk = await readFile(filePath);
      return { exitCode: 0, stderr: "" };
    });

    await writeFlashImage(externalProcess, { tool: "esptool", port: "COM3", timeoutMs: TIMEOUT_MS }, image);

    expect(externalProcess.calls[0].command).toBe("esptool.py");
    expect(externalProcess.calls[0].args.slice(0, -1)).toEqual(["--chip", "esp32", "--port", "COM3", "write_flash", "0x0"]);
    expect(writtenToDisk?.equals(image)).toBe(true);
  });

  it("propaga el error si avrdude falla", async () => {
    const externalProcess = new FakeExternalProcess(() => ({ exitCode: 1, stderr: "avrdude: verificación falló" }));

    await expect(
      writeFlashImage(externalProcess, { tool: "avrdude", port: "COM4", timeoutMs: TIMEOUT_MS }, Buffer.from([1])),
    ).rejects.toThrow(/verificación falló/);
  });
});

describe("resolveFlashToolConfig", () => {
  const originalTool = process.env.KAN_ESP32_FLASH_TOOL;

  afterEach(() => {
    if (originalTool === undefined) delete process.env.KAN_ESP32_FLASH_TOOL;
    else process.env.KAN_ESP32_FLASH_TOOL = originalTool;
  });

  it("por defecto usa esptool", () => {
    delete process.env.KAN_ESP32_FLASH_TOOL;
    expect(resolveFlashToolConfig("COM3", 1000).tool).toBe("esptool");
  });

  it("KAN_ESP32_FLASH_TOOL=avrdude cambia la herramienta", () => {
    process.env.KAN_ESP32_FLASH_TOOL = "avrdude";
    expect(resolveFlashToolConfig("COM3", 1000).tool).toBe("avrdude");
  });
});
