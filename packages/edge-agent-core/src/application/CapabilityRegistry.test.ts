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
import { PermissionManager } from "./PermissionManager";
import { CapabilityRegistry } from "./CapabilityRegistry";
import type { LoggerPort } from "../domain/ports/LoggerPort";

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class FakeDriver extends KanDeviceDriverPlugin {
  readonly kind = "fake";
  readonly manifest: PluginManifest = {
    id: "fake-driver",
    version: "0.0.1",
    displayName: "Fake Driver",
    kind: "device-driver",
    runtime: "in-process-ts",
  };

  async discover(): Promise<DeviceDescriptor[]> {
    return [{ id: "fake-1", name: "Fake Device", kind: this.kind }];
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  getCapabilities(): CapabilityDescriptor[] {
    return [
      { name: "read_only_cap", description: "...", severity: "read-only", supportsDryRun: false },
      { name: "dangerous_cap", description: "...", severity: "irreversible-material", supportsDryRun: false },
    ];
  }

  async invoke(_deviceId: string, capabilityName: string): Promise<CapabilityResult> {
    if (capabilityName === "throws") throw new Error("boom");
    return { success: true, data: { capabilityName } };
  }
}

describe("CapabilityRegistry", () => {
  let bus: EdgeAgentBus;
  let logger: LoggerPort;
  let deviceManager: DeviceManager;
  let permissionManager: PermissionManager;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    bus = new EdgeAgentBus();
    logger = createLogger();
    deviceManager = new DeviceManager(bus, logger);
    permissionManager = new PermissionManager(bus, logger);
    registry = new CapabilityRegistry(deviceManager, permissionManager, bus, logger);
    await deviceManager.discoverAll([new FakeDriver()]);
  });

  it("list() agrega las capabilities de todos los dispositivos descubiertos", () => {
    const listing = registry.list();
    expect(listing).toHaveLength(2);
    expect(listing.map((l) => l.capability.name)).toEqual(["read_only_cap", "dangerous_cap"]);
  });

  it("invoke() de una capability read-only se ejecuta directo", async () => {
    const outcome = await registry.invoke("fake-1", "read_only_cap", {});
    expect(outcome).toEqual({ status: "executed", result: { success: true, data: { capabilityName: "read_only_cap" } } });
  });

  it("invoke() de una capability irreversible-material queda pendiente", async () => {
    const outcome = await registry.invoke("fake-1", "dangerous_cap", {});
    expect(outcome.status).toBe("pending_confirmation");
  });

  it("invoke() de un dispositivo desconocido lanza", async () => {
    await expect(registry.invoke("no-existe", "read_only_cap", {})).rejects.toThrow(/Capability desconocida/);
  });

  it("invoke() de una capability desconocida en un dispositivo real lanza", async () => {
    await expect(registry.invoke("fake-1", "no-existe", {})).rejects.toThrow(/Capability desconocida/);
  });

  it("executeConfirmed(approved=true) ejecuta la capability pendiente", async () => {
    const pending = await registry.invoke("fake-1", "dangerous_cap", {});
    if (pending.status !== "pending_confirmation") throw new Error("se esperaba pending_confirmation");

    const outcome = await registry.executeConfirmed(pending.confirmationId, true);
    expect(outcome).toEqual({
      status: "executed",
      result: { success: true, data: { capabilityName: "dangerous_cap" } },
    });
  });

  it("executeConfirmed(approved=false) NO ejecuta y devuelve rechazo", async () => {
    const pending = await registry.invoke("fake-1", "dangerous_cap", {});
    if (pending.status !== "pending_confirmation") throw new Error("se esperaba pending_confirmation");

    const outcome = await registry.executeConfirmed(pending.confirmationId, false);
    expect(outcome).toEqual({ status: "executed", result: { success: false, error: "Rechazado por el usuario" } });
  });

  it("executeConfirmed() con un id desconocido devuelve undefined", async () => {
    expect(await registry.executeConfirmed("no-existe", true)).toBeUndefined();
  });

  it("un driver que lanza se convierte en CapabilityResult failed, no en excepción sin manejar", async () => {
    // read-only para forzar ejecución directa
    const capabilities = deviceManager.getDevice("fake-1")!.capabilities;
    capabilities.push({ name: "throws", description: "...", severity: "read-only", supportsDryRun: false });

    const outcome = await registry.invoke("fake-1", "throws", {});
    expect(outcome).toEqual({ status: "executed", result: { success: false, error: "boom" } });
  });
});
