import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileDeviceStore } from "./JsonFileDeviceStore";
import type { KnownDeviceRecord } from "../domain/entities/KnownDevice";

describe("JsonFileDeviceStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kan-device-store-"));
    filePath = join(dir, "known-devices.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sin archivo previo, arranca vacío", () => {
    const store = new JsonFileDeviceStore(filePath);
    expect(store.load()).toEqual([]);
  });

  it("save() deja los registros disponibles de inmediato en memoria (get() nunca ve datos viejos, mismo criterio que JsonFileConfigStore)", () => {
    const store = new JsonFileDeviceStore(filePath);
    const records: KnownDeviceRecord[] = [
      { id: "serial:COM3", name: "Raspberry Pi Pico", transport: "serial", address: "COM3", lastSeenAt: "2026-08-18T10:00:00.000Z" },
    ];
    store.save(records);
    expect(store.load()).toEqual(records);
  });

  it("persiste a disco — un store nuevo apuntando al mismo archivo ve los mismos registros tras el debounce", async () => {
    const store = new JsonFileDeviceStore(filePath);
    const records: KnownDeviceRecord[] = [
      { id: "serial:COM3", name: "Raspberry Pi Pico", transport: "serial", address: "COM3", lastSeenAt: "2026-08-18T10:00:00.000Z" },
    ];
    store.save(records);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const reloaded = new JsonFileDeviceStore(filePath);
    expect(reloaded.load()).toEqual(records);
  });
});
