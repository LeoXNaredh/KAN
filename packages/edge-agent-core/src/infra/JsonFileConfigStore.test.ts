import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileConfigStore } from "./JsonFileConfigStore";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("JsonFileConfigStore — escritura incremental (fix de auditoría de backend)", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kan-config-store-"));
    filePath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sin archivo previo, arranca vacío", () => {
    const store = new JsonFileConfigStore(filePath);
    expect(store.all()).toEqual({});
  });

  it("set() actualiza el valor en memoria de inmediato, antes de que corra ninguna escritura", () => {
    const store = new JsonFileConfigStore(filePath);
    store.set("foo", "bar");
    expect(store.get("foo")).toBe("bar");
  });

  it("tras flush(), el valor está en disco — un store nuevo apuntando al mismo archivo lo ve", async () => {
    const store = new JsonFileConfigStore(filePath);
    store.set("pairingToken", "secreto");
    await store.flush();

    expect(existsSync(filePath)).toBe(true);
    const reloaded = new JsonFileConfigStore(filePath);
    expect(reloaded.get("pairingToken")).toBe("secreto");
  });

  it("varios set() seguidos antes del debounce se coalescen en una sola escritura, sin perder ninguna clave", async () => {
    const store = new JsonFileConfigStore(filePath);
    store.set("a", 1);
    store.set("b", 2);
    store.set("c", 3);
    await store.flush();

    const onDisk = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(onDisk).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("sin llamar flush(), el debounce igual persiste solo después de esperar", async () => {
    const store = new JsonFileConfigStore(filePath);
    store.set("foo", "bar");

    // Recién escrito el archivo — mismo criterio que el resto del repo, sin
    // mockear timers: se espera el debounce real (corto, 50ms) en vez de
    // simularlo.
    await wait(200);

    const onDisk = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(onDisk).toEqual({ foo: "bar" });
  });

  it("flush() sin ningún set() pendiente no falla y resuelve al toque", async () => {
    const store = new JsonFileConfigStore(filePath);
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it("un archivo con JSON corrupto se trata como vacío, no lanza", () => {
    writeFileSync(filePath, "{ esto no es json válido", "utf-8");

    const store = new JsonFileConfigStore(filePath);
    expect(store.all()).toEqual({});
  });
});
