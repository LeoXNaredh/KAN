import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  CapabilityDescriptor,
  CapabilityResult,
  DeviceDescriptor,
  PluginManifest,
} from "@kan/plugin-contract";
import { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import { EdgeAgentBus } from "./EdgeAgentBus";
import { DeviceManager } from "./DeviceManager";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { DeviceStorePort } from "../domain/ports/DeviceStorePort";
import type { KnownDeviceRecord } from "../domain/entities/KnownDevice";

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Fake en memoria — mismo contrato que JsonFileDeviceStore, sin tocar disco. */
class FakeDeviceStore implements DeviceStorePort {
  records: KnownDeviceRecord[] = [];
  load(): KnownDeviceRecord[] {
    return this.records;
  }
  save(records: KnownDeviceRecord[]): void {
    this.records = records;
  }
}

class SlowDriver extends KanDeviceDriverPlugin {
  readonly kind = "slow";
  readonly manifest: PluginManifest;

  constructor(
    private readonly id_: string,
    private readonly delayMs: number,
    private readonly log: string[],
  ) {
    super();
    // Asignado en el cuerpo del constructor (no como field initializer) para
    // evitar el orden de inicialización de campos de clase vs. parameter
    // properties de TS, que dejaría this.id_ en undefined si se leyera arriba.
    this.manifest = {
      id: this.id_,
      version: "0.0.1",
      displayName: "Slow Driver",
      kind: "device-driver",
      runtime: "in-process-ts",
      permissions: { devices: ["slow"], network: false, filesystem: [] },
    };
  }

  async discover(): Promise<DeviceDescriptor[]> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.log.push(`discovered:${this.id_}`);
    return [{ id: `${this.id_}-device`, name: this.id_, kind: this.kind }];
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.log.push(`disconnected:${this.id_}`);
  }
  getCapabilities(): CapabilityDescriptor[] {
    return [];
  }
  async invoke(): Promise<CapabilityResult> {
    return { success: true };
  }
}

describe("DeviceManager", () => {
  let bus: EdgeAgentBus;
  let logger: LoggerPort;
  let manager: DeviceManager;

  beforeEach(() => {
    bus = new EdgeAgentBus();
    logger = createLogger();
    manager = new DeviceManager(bus, logger);
  });

  it("descubre dispositivos de múltiples drivers en paralelo, no secuencialmente (hallazgo M12 de docs/13)", async () => {
    const log: string[] = [];
    const drivers = [new SlowDriver("a", 30, log), new SlowDriver("b", 30, log), new SlowDriver("c", 30, log)];

    const start = Date.now();
    const devices = await manager.discoverAll(drivers);
    const elapsed = Date.now() - start;

    expect(devices).toHaveLength(3);
    // Si fuera secuencial tomaría ~90ms; en paralelo debe quedar cerca de 30ms.
    // Margen generoso para evitar flakiness en CI lento.
    expect(elapsed).toBeLessThan(80);
  });

  it("emite device.connected por cada dispositivo descubierto", async () => {
    const handler = vi.fn();
    bus.on("device.connected", handler);
    await manager.discoverAll([new SlowDriver("a", 0, [])]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("list()/getDevice() reflejan los dispositivos descubiertos", async () => {
    await manager.discoverAll([new SlowDriver("a", 0, [])]);
    expect(manager.list()).toHaveLength(1);
    expect(manager.getDevice("a-device")?.status).toBe("connected");
  });

  it("disconnect() marca el dispositivo como desconectado y emite el evento", async () => {
    await manager.discoverAll([new SlowDriver("a", 0, [])]);
    const handler = vi.fn();
    bus.on("device.disconnected", handler);

    await manager.disconnect("a-device");

    expect(manager.getDevice("a-device")?.status).toBe("disconnected");
    expect(handler).toHaveBeenCalledWith({ deviceId: "a-device" });
  });

  it("disconnect() de un dispositivo desconocido no lanza", async () => {
    await expect(manager.disconnect("no-existe")).resolves.toBeUndefined();
  });

  it("discoverAll() es idempotente: un dispositivo ya conocido no se reconecta ni remite device.connected de nuevo", async () => {
    const driver = new SlowDriver("a", 0, []);
    await manager.discoverAll([driver]);

    const handler = vi.fn();
    bus.on("device.connected", handler);
    const second = await manager.discoverAll([driver]);

    expect(second).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
    expect(manager.list()).toHaveLength(1);
  });

  it("sin deviceStore, listKnown() devuelve vacío y discoverAll() no falla (ej. browser.ts, sin filesystem)", async () => {
    await manager.discoverAll([new SlowDriver("a", 0, [])]);
    expect(manager.listKnown()).toEqual([]);
  });

  describe("memoria de dispositivos entre reinicios", () => {
    it("con un deviceStore, cada dispositivo descubierto se persiste con su fecha de última vez visto", async () => {
      const store = new FakeDeviceStore();
      const withStore = new DeviceManager(bus, logger, store);

      await withStore.discoverAll([new SlowDriver("a", 0, [])]);

      expect(store.records).toHaveLength(1);
      expect(store.records[0]).toMatchObject({ id: "a-device", name: "a" });
      expect(store.records[0].lastSeenAt).toEqual(expect.any(String));
    });

    it("un DeviceManager nuevo apuntando al mismo store carga los dispositivos ya vistos en listKnown(), sin que aparezcan como conectados", async () => {
      const store = new FakeDeviceStore();
      const first = new DeviceManager(bus, logger, store);
      await first.discoverAll([new SlowDriver("a", 0, [])]);

      const second = new DeviceManager(new EdgeAgentBus(), logger, store);

      expect(second.listKnown()).toHaveLength(1);
      expect(second.listKnown()[0].id).toBe("a-device");
      // La Pico "ya sabida" no está conectada hasta que discoverAll() la vuelva a encontrar.
      expect(second.list()).toEqual([]);
    });

    it("un dispositivo ya conocido que vuelve a aparecer se reconecta normalmente (no queda huérfano por el guard de idempotencia)", async () => {
      const store = new FakeDeviceStore();
      const first = new DeviceManager(bus, logger, store);
      await first.discoverAll([new SlowDriver("a", 0, [])]);

      const second = new DeviceManager(new EdgeAgentBus(), logger, store);
      const rediscovered = await second.discoverAll([new SlowDriver("a", 0, [])]);

      expect(rediscovered).toHaveLength(1);
      expect(second.list()).toHaveLength(1);
    });
  });
});
