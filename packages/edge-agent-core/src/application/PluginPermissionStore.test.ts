import { describe, expect, it } from "vitest";
import type { PluginPermissions } from "@kan/plugin-contract";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import { PluginPermissionStore } from "./PluginPermissionStore";

function createInMemoryConfigStore(): ConfigStorePort {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      data.set(key, value);
    },
    all: () => Object.fromEntries(data),
  };
}

const PERMS: PluginPermissions = { devices: ["fake"], network: false, filesystem: [] };

describe("PluginPermissionStore", () => {
  it("get() devuelve undefined cuando no hay nada otorgado todavía", () => {
    const store = new PluginPermissionStore(createInMemoryConfigStore());
    expect(store.get("plugin-1")).toBeUndefined();
  });

  it("grant() persiste y get() lo devuelve", () => {
    const store = new PluginPermissionStore(createInMemoryConfigStore());
    store.grant("plugin-1", PERMS);
    expect(store.get("plugin-1")).toEqual(PERMS);
  });

  it("no pisa el grant de otro plugin", () => {
    const store = new PluginPermissionStore(createInMemoryConfigStore());
    store.grant("plugin-1", PERMS);
    store.grant("plugin-2", { devices: ["otro"], network: true, filesystem: ["read:x"] });

    expect(store.get("plugin-1")).toEqual(PERMS);
    expect(store.get("plugin-2")).toEqual({ devices: ["otro"], network: true, filesystem: ["read:x"] });
  });

  it("un grant posterior reemplaza al anterior para el mismo plugin", () => {
    const store = new PluginPermissionStore(createInMemoryConfigStore());
    store.grant("plugin-1", PERMS);
    const updated: PluginPermissions = { devices: ["fake", "extra"], network: true, filesystem: [] };
    store.grant("plugin-1", updated);

    expect(store.get("plugin-1")).toEqual(updated);
  });

  it("sobrevive a una nueva instancia sobre el mismo configStore (persistencia real)", () => {
    const configStore = createInMemoryConfigStore();
    new PluginPermissionStore(configStore).grant("plugin-1", PERMS);

    const reloaded = new PluginPermissionStore(configStore);
    expect(reloaded.get("plugin-1")).toEqual(PERMS);
  });
});
