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

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
});
