import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomVidPidCatalogStore } from "./CustomVidPidCatalogStore";

describe("CustomVidPidCatalogStore", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  function tempPath(): string {
    const filePath = join(tmpdir(), `kan-vidpid-custom-test-${randomUUID()}.json`);
    tempFiles.push(filePath);
    return filePath;
  }

  it("un archivo inexistente arranca con lista vacía sin lanzar", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    expect(store.list()).toEqual([]);
  });

  it("add() hace visible el dispositivo de inmediato en list()", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    const entry = store.add({ name: "Mi PLC Siemens custom", vendorId: "0x1234", productId: "0x5678" });

    expect(entry).toEqual({ name: "Mi PLC Siemens custom", vendorId: "0x1234", productId: "0x5678" });
    expect(store.list()).toEqual([entry]);
  });

  it("persiste a disco — una nueva instancia sobre el mismo archivo recupera los dispositivos", () => {
    const filePath = tempPath();
    const store = new CustomVidPidCatalogStore(filePath);
    store.add({ name: "Mi PLC Siemens custom", vendorId: "0x1234", productId: "0x5678" });

    const reloaded = new CustomVidPidCatalogStore(filePath);
    expect(reloaded.list()).toEqual([{ name: "Mi PLC Siemens custom", vendorId: "0x1234", productId: "0x5678" }]);
  });

  it("remove() lo quita de list()", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    store.add({ name: "Mi PLC Siemens custom", vendorId: "0x1234", productId: "0x5678" });

    store.remove("0x1234", "0x5678");

    expect(store.list()).toEqual([]);
  });

  it("remove() de un VID/PID normalizado distinto (sin '0x', mayúsculas) igual lo encuentra", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    store.add({ name: "Mi PLC Siemens custom", vendorId: "0x1234", productId: "0x5678" });

    store.remove("1234", "5678");

    expect(store.list()).toEqual([]);
  });

  it("remove() de un dispositivo inexistente no lanza", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    expect(() => store.remove("0xffff", "0xffff")).not.toThrow();
  });

  it("rechaza sin nombre", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    expect(() => store.add({ name: "  ", vendorId: "0x1234", productId: "0x5678" })).toThrow("nombre");
    expect(store.list()).toEqual([]);
  });

  it.each([
    ["texto no hexadecimal", "no-es-hex"],
    ["más de 4 dígitos", "0x12345"],
    ["vacío", ""],
  ])("rechaza un VID inválido (%s)", (_label, vendorId) => {
    const store = new CustomVidPidCatalogStore(tempPath());
    expect(() => store.add({ name: "x", vendorId, productId: "0x5678" })).toThrow("VID");
  });

  it("rechaza un PID inválido", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    expect(() => store.add({ name: "x", vendorId: "0x1234", productId: "no-es-hex" })).toThrow("PID");
  });

  it("rechaza un VID/PID duplicado (mismo par ya agregado, sin importar mayúsculas/'0x')", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    store.add({ name: "Original", vendorId: "0x1234", productId: "0x5678" });

    expect(() => store.add({ name: "Otro nombre", vendorId: "1234", productId: "5678" })).toThrow();
    expect(store.list()).toHaveLength(1);
  });

  it("VID/PID válidos sin prefijo '0x' también se aceptan", () => {
    const store = new CustomVidPidCatalogStore(tempPath());
    expect(() => store.add({ name: "x", vendorId: "1234", productId: "5678" })).not.toThrow();
  });
});
