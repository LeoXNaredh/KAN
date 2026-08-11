// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { LocalStorageConfigStore } from "./LocalStorageConfigStore";

/**
 * Node ≥22 trae su propio `localStorage` global experimental (respaldado
 * por archivo, deshabilitado sin `--localstorage-file`) que en este entorno
 * de test termina pisando al `window.localStorage` real de jsdom — no pasa
 * en un navegador de verdad, es puramente un choque Node/jsdom/Vitest.
 * Se reemplaza acá por un shim en memoria para no depender de esa carrera.
 */
function installFakeLocalStorage(): void {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

describe("LocalStorageConfigStore", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("get() devuelve undefined para una key nunca seteada", () => {
    const store = new LocalStorageConfigStore("kan:test");
    expect(store.get("edgeAgentId")).toBeUndefined();
  });

  it("set() persiste el valor y get() lo devuelve", () => {
    const store = new LocalStorageConfigStore("kan:test");
    store.set("edgeAgentId", "agent-123");
    expect(store.get("edgeAgentId")).toBe("agent-123");
  });

  it("all() devuelve una copia de todo lo guardado", () => {
    const store = new LocalStorageConfigStore("kan:test");
    store.set("edgeAgentId", "agent-123");
    store.set("pairingToken", "secret");
    expect(store.all()).toEqual({ edgeAgentId: "agent-123", pairingToken: "secret" });
  });

  it("un segundo store con la misma storageKey lee lo que persistió el primero", () => {
    const first = new LocalStorageConfigStore("kan:test");
    first.set("edgeAgentId", "agent-123");

    const second = new LocalStorageConfigStore("kan:test");
    expect(second.get("edgeAgentId")).toBe("agent-123");
  });

  it("dos storageKey distintas no se pisan entre sí", () => {
    const a = new LocalStorageConfigStore("kan:a");
    const b = new LocalStorageConfigStore("kan:b");

    a.set("edgeAgentId", "agent-a");
    b.set("edgeAgentId", "agent-b");

    expect(a.get("edgeAgentId")).toBe("agent-a");
    expect(b.get("edgeAgentId")).toBe("agent-b");
  });

  it("JSON corrupto en localStorage no lanza — arranca vacío", () => {
    window.localStorage.setItem("kan:test", "{esto no es json válido");
    const store = new LocalStorageConfigStore("kan:test");
    expect(store.all()).toEqual({});
  });
});
