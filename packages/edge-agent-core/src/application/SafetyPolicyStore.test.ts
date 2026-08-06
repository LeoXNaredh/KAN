import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CapabilityDescriptor } from "@kan/plugin-contract";
import { EdgeAgentBus } from "./EdgeAgentBus";
import { SafetyPolicyStore } from "./SafetyPolicyStore";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";

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

const writeDigitalPin: CapabilityDescriptor = {
  name: "write_digital_pin",
  description: "...",
  severity: "irreversible-material",
  supportsDryRun: false,
  targetParam: "pin",
};

const readSensor: CapabilityDescriptor = {
  name: "read_sensor",
  description: "...",
  severity: "read-only",
  supportsDryRun: false,
};

describe("SafetyPolicyStore", () => {
  let configStore: ConfigStorePort;
  let bus: EdgeAgentBus;
  let store: SafetyPolicyStore;

  beforeEach(() => {
    configStore = createInMemoryConfigStore();
    bus = new EdgeAgentBus();
    store = new SafetyPolicyStore(configStore, bus);
  });

  it("capabilities sin targetParam siempre usan su severidad declarada, sin importar el input", () => {
    expect(store.resolveSeverity("dev-1", readSensor, { anything: 1 })).toBe("read-only");
  });

  it("un target sin override (pin sin configurar) cae en la severidad de la capability (regla 4: fail-closed)", () => {
    expect(store.resolveSeverity("dev-1", writeDigitalPin, { pin: 5, value: true })).toBe("irreversible-material");
  });

  it("un override explícito del usuario sobrescribe la severidad para ese target", () => {
    store.set("dev-1", "5", { severity: "reversible", alias: "LED interno" });
    expect(store.resolveSeverity("dev-1", writeDigitalPin, { pin: 5, value: true })).toBe("reversible");
  });

  it("el override es específico por target: otro pin sin configurar sigue siendo restrictivo", () => {
    store.set("dev-1", "2", { severity: "reversible", alias: "LED interno" });
    expect(store.resolveSeverity("dev-1", writeDigitalPin, { pin: 5, value: true })).toBe("irreversible-material");
  });

  it("el override es específico por dispositivo", () => {
    store.set("dev-1", "5", { severity: "reversible" });
    expect(store.resolveSeverity("dev-2", writeDigitalPin, { pin: 5, value: true })).toBe("irreversible-material");
  });

  it("set() persiste vía ConfigStorePort y sobrevive una nueva instancia del store", () => {
    store.set("dev-1", "5", { severity: "reversible", alias: "LED interno" });
    const reloaded = new SafetyPolicyStore(configStore, bus);
    expect(reloaded.get("dev-1", "5")).toMatchObject({ severity: "reversible", alias: "LED interno" });
  });

  it("set() emite safety_policy.changed con la severidad anterior cuando ya había un override", () => {
    const handler = vi.fn();
    bus.on("safety_policy.changed", handler);

    store.set("dev-1", "5", { severity: "irreversible-material" });
    store.set("dev-1", "5", { severity: "reversible" });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0]).toMatchObject({
      entry: { severity: "reversible" },
      previousSeverity: "irreversible-material",
    });
  });

  it("listForDevice() devuelve todos los overrides configurados para un dispositivo", () => {
    store.set("dev-1", "5", { severity: "irreversible-material", alias: "Relé bomba de agua" });
    store.set("dev-1", "2", { severity: "reversible", alias: "LED interno" });
    expect(store.listForDevice("dev-1")).toHaveLength(2);
    expect(store.listForDevice("dev-2")).toHaveLength(0);
  });
});
