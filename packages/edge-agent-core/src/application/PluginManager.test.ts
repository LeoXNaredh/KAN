import { describe, expect, it, vi } from "vitest";
import type { CapabilityResult, DeviceDescriptor, PluginManifest, PluginPermissions } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import { EdgeAgentBus } from "./EdgeAgentBus";
import { PluginManager } from "./PluginManager";
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

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const PERMS: PluginPermissions = { devices: ["fake"], network: false, filesystem: [] };

class FakeDriver extends KanDeviceDriverPlugin {
  readonly kind = "fake";
  readonly manifest: PluginManifest;
  readonly onLoad = vi.fn(async () => {});
  readonly onUnload = vi.fn(async () => {});

  constructor(id = "fake-driver", permissions: PluginPermissions = PERMS) {
    super();
    this.manifest = {
      id,
      version: "0.0.1",
      displayName: "Fake Driver",
      kind: "device-driver",
      runtime: "in-process-ts",
      permissions,
    };
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [];
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getCapabilities() {
    return [];
  }
  async invoke(): Promise<CapabilityResult> {
    return { success: true };
  }
}

describe("PluginManager — gate de permisos deny-by-default (P8, ADR-041)", () => {
  it("register() sin grant previo deja el plugin en 'loaded', no lo habilita, y avisa por el bus", async () => {
    const bus = new EdgeAgentBus();
    const pending = vi.fn();
    bus.on("plugin.permission_pending", pending);
    const manager = new PluginManager(bus, createLogger(), createInMemoryConfigStore());
    const driver = new FakeDriver();

    const instance = await manager.register(driver);

    expect(instance.status).toBe("loaded");
    expect(driver.onLoad).not.toHaveBeenCalled();
    expect(manager.getEnabledDrivers()).toHaveLength(0);
    expect(pending).toHaveBeenCalledWith({
      pluginId: "fake-driver",
      displayName: "Fake Driver",
      permissions: PERMS,
    });
  });

  it("register() con un grant previo idéntico habilita directo, sin pedir aprobación de nuevo", async () => {
    const configStore = createInMemoryConfigStore();
    new PluginPermissionStore(configStore).grant("fake-driver", PERMS);
    const bus = new EdgeAgentBus();
    const pending = vi.fn();
    bus.on("plugin.permission_pending", pending);
    const manager = new PluginManager(bus, createLogger(), configStore);
    const driver = new FakeDriver();

    const instance = await manager.register(driver);

    expect(instance.status).toBe("enabled");
    expect(driver.onLoad).toHaveBeenCalledOnce();
    expect(manager.getEnabledDrivers()).toEqual([driver]);
    expect(pending).not.toHaveBeenCalled();
  });

  it("register() con permisos que cambiaron desde el último grant vuelve a pedir aprobación", async () => {
    const configStore = createInMemoryConfigStore();
    new PluginPermissionStore(configStore).grant("fake-driver", { devices: ["fake"], network: false, filesystem: [] });
    const bus = new EdgeAgentBus();
    const manager = new PluginManager(bus, createLogger(), configStore);
    // Ahora pide también acceso a red — distinto de lo ya otorgado.
    const driver = new FakeDriver("fake-driver", { devices: ["fake"], network: true, filesystem: [] });

    const instance = await manager.register(driver);

    expect(instance.status).toBe("loaded");
    expect(driver.onLoad).not.toHaveBeenCalled();
  });

  it("approve() habilita el plugin pendiente, persiste el grant, y devuelve el driver", async () => {
    const configStore = createInMemoryConfigStore();
    const bus = new EdgeAgentBus();
    const resolved = vi.fn();
    bus.on("plugin.permission_resolved", resolved);
    const manager = new PluginManager(bus, createLogger(), configStore);
    const driver = new FakeDriver();
    await manager.register(driver);

    const approvedDriver = await manager.approve("fake-driver");

    expect(approvedDriver).toBe(driver);
    expect(driver.onLoad).toHaveBeenCalledOnce();
    expect(manager.getEnabledDrivers()).toEqual([driver]);
    expect(resolved).toHaveBeenCalledWith({ pluginId: "fake-driver", approved: true });
    expect(new PluginPermissionStore(configStore).get("fake-driver")).toEqual(PERMS);
  });

  it("approve() de un pluginId inexistente o ya resuelto es un no-op", async () => {
    const manager = new PluginManager(new EdgeAgentBus(), createLogger(), createInMemoryConfigStore());
    expect(await manager.approve("no-existe")).toBeUndefined();
  });

  it("reject() nunca habilita el plugin ni llama onLoad()", async () => {
    const bus = new EdgeAgentBus();
    const resolved = vi.fn();
    bus.on("plugin.permission_resolved", resolved);
    const manager = new PluginManager(bus, createLogger(), createInMemoryConfigStore());
    const driver = new FakeDriver();
    await manager.register(driver);

    manager.reject("fake-driver");

    expect(driver.onLoad).not.toHaveBeenCalled();
    expect(manager.getEnabledDrivers()).toHaveLength(0);
    expect(resolved).toHaveBeenCalledWith({ pluginId: "fake-driver", approved: false });
  });

  it("listPendingPermissions() solo devuelve instancias en 'loaded'", async () => {
    const configStore = createInMemoryConfigStore();
    new PluginPermissionStore(configStore).grant("already-approved", PERMS);
    const manager = new PluginManager(new EdgeAgentBus(), createLogger(), configStore);
    await manager.register(new FakeDriver("pending-1"));
    await manager.register(new FakeDriver("already-approved"));

    const pending = manager.listPendingPermissions();

    expect(pending.map((i) => i.manifest.id)).toEqual(["pending-1"]);
  });

  it("register() sigue funcionando de punta a punta tras reiniciar (mismo configStore, mismo permiso ya otorgado)", async () => {
    const configStore = createInMemoryConfigStore();
    const bus1 = new EdgeAgentBus();
    const manager1 = new PluginManager(bus1, createLogger(), configStore);
    await manager1.register(new FakeDriver());
    await manager1.approve("fake-driver");

    // "Reinicio de la app": nueva instancia de PluginManager sobre el mismo configStore.
    const manager2 = new PluginManager(new EdgeAgentBus(), createLogger(), configStore);
    const secondDriver = new FakeDriver();
    const instance = await manager2.register(secondDriver);

    expect(instance.status).toBe("enabled");
    expect(secondDriver.onLoad).toHaveBeenCalledOnce();
  });
});
