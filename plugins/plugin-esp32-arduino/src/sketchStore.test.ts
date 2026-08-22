import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SketchStore } from "./sketchStore";

describe("SketchStore", () => {
  let baseDir: string;
  let store: SketchStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "kan-sketchstore-test-"));
    store = new SketchStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("listFiles() devuelve [] para un dispositivo sin sketch guardado todavía", async () => {
    expect(await store.listFiles("esp32_serial_COM3")).toEqual([]);
  });

  it("writeFile() con un .ino lo guarda como <deviceId>.ino, sin importar el nombre original", async () => {
    await store.writeFile("esp32_serial_COM3", "mi_sketch_original.ino", "void setup(){}\nvoid loop(){}");

    const files = await store.listFiles("esp32_serial_COM3");
    expect(files).toEqual([{ path: "esp32_serial_COM3.ino", sizeBytes: expect.any(Number) }]);
  });

  it("readFile() lee de vuelta el contenido guardado", async () => {
    await store.writeFile("esp32_serial_COM3", "sketch.ino", "void setup(){}");

    expect(await store.readFile("esp32_serial_COM3", "esp32_serial_COM3.ino")).toBe("void setup(){}");
  });

  it("guarda archivos compañeros (.h) tal cual, no renombrados", async () => {
    await store.writeFile("esp32_serial_COM3", "sketch.ino", "void setup(){}");
    await store.writeFile("esp32_serial_COM3", "config.h", "#define PIN 5");

    const files = (await store.listFiles("esp32_serial_COM3")).map((f) => f.path).sort();
    expect(files).toEqual(["config.h", "esp32_serial_COM3.ino"]);
    expect(await store.readFile("esp32_serial_COM3", "config.h")).toBe("#define PIN 5");
  });

  it("aplana subcarpetas — un path con subcarpeta se guarda por su basename", async () => {
    await store.writeFile("esp32_serial_COM3", "src/helper.h", "int x;");

    expect(await store.listFiles("esp32_serial_COM3")).toEqual([{ path: "helper.h", sizeBytes: expect.any(Number) }]);
  });

  it("mainSketchPath()/mainSketchFile() apuntan al archivo que arduino-cli espera (mismo nombre que la carpeta)", async () => {
    expect(store.mainSketchFile("esp32_serial_COM3")).toBe("esp32_serial_COM3.ino");
    expect(store.mainSketchPath("esp32_serial_COM3")).toBe(join(baseDir, "esp32_serial_COM3", "esp32_serial_COM3.ino"));
  });

  it("dispositivos distintos no se pisan entre sí", async () => {
    await store.writeFile("device-a", "sketch.ino", "// A");
    await store.writeFile("device-b", "sketch.ino", "// B");

    expect(await store.readFile("device-a", "device-a.ino")).toBe("// A");
    expect(await store.readFile("device-b", "device-b.ino")).toBe("// B");
  });
});
