import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { loadVidPidCatalog } from "./loadVidPidCatalog";

describe("loadVidPidCatalog", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it("sin customPath, devuelve el catálogo base tal cual", () => {
    const catalog = loadVidPidCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.some((e) => e.name.includes("Arduino Uno R3"))).toBe(true);
  });

  it("con customPath que no existe, devuelve el catálogo base sin fallar", () => {
    const catalog = loadVidPidCatalog(join(tmpdir(), "no-existe-de-verdad", "vid-pid-custom.json"));
    expect(catalog.some((e) => e.name.includes("Arduino Uno R3"))).toBe(true);
  });

  it("mergea el catálogo custom sobre el base — un VID/PID nuevo se agrega", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kan-vid-pid-"));
    const customPath = join(tmpDir, "vid-pid-custom.json");
    writeFileSync(customPath, JSON.stringify([{ vendorId: "0x1234", productId: "0x5678", name: "PLC industrial custom" }]));

    const catalog = loadVidPidCatalog(customPath);

    expect(catalog.some((e) => e.name === "PLC industrial custom")).toBe(true);
    expect(catalog.some((e) => e.name.includes("Arduino Uno R3"))).toBe(true); // el base sigue presente
  });

  it("una entrada custom con el mismo VID/PID que una del base la pisa", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kan-vid-pid-"));
    const customPath = join(tmpDir, "vid-pid-custom.json");
    writeFileSync(customPath, JSON.stringify([{ vendorId: "0x2341", productId: "0x0043", name: "Mi Arduino modificado" }]));

    const catalog = loadVidPidCatalog(customPath);
    const entries = catalog.filter((e) => e.vendorId.toLowerCase().replace(/^0x/, "") === "2341" && e.productId.toLowerCase().replace(/^0x/, "") === "0043");

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Mi Arduino modificado");
  });

  it("un JSON custom corrupto no tira — se ignora y queda solo el base", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kan-vid-pid-"));
    const customPath = join(tmpDir, "vid-pid-custom.json");
    writeFileSync(customPath, "{ esto no es JSON válido");

    const catalog = loadVidPidCatalog(customPath);

    expect(catalog.some((e) => e.name.includes("Arduino Uno R3"))).toBe(true);
  });

  it("entradas custom mal formadas (sin 'name', etc.) se filtran, no rompen el resto", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kan-vid-pid-"));
    const customPath = join(tmpDir, "vid-pid-custom.json");
    writeFileSync(
      customPath,
      JSON.stringify([{ vendorId: "0x9999", productId: "0x1111" }, { vendorId: "0xAAAA", productId: "0xBBBB", name: "Válido" }]),
    );

    const catalog = loadVidPidCatalog(customPath);

    expect(catalog.some((e) => e.name === "Válido")).toBe(true);
    expect(catalog.some((e) => e.vendorId === "0x9999")).toBe(false);
  });
});
