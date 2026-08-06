import { describe, expect, it } from "vitest";
import type { CapabilityDescriptor } from "@kan/plugin-contract";
import { GatewayBus } from "./GatewayBus";
import { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";

const CAP: CapabilityDescriptor = {
  name: "read_sensor",
  description: "...",
  severity: "read-only",
  supportsDryRun: false,
};

describe("GlobalCapabilityRegistry", () => {
  it("genera un ref único y saneado por agente+dispositivo+capability", () => {
    const registry = new GlobalCapabilityRegistry(new GatewayBus());
    registry.sync("edge-agent-uuid-1234", [{ deviceId: "simulator-1", capability: CAP }]);

    const [entry] = registry.list();
    expect(entry.ref).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(entry.ref).toContain("simulator-1");
    expect(entry.ref).toContain("read_sensor");
  });

  it("sanea caracteres no válidos en deviceId/capabilityName (ref debe ser un nombre de tool seguro)", () => {
    const registry = new GlobalCapabilityRegistry(new GatewayBus());
    registry.sync("agent:1", [
      { deviceId: "dev with spaces/slash", capability: { ...CAP, name: "cap.with.dots" } },
    ]);

    const [entry] = registry.list();
    expect(entry.ref).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("dos agentes distintos con la misma capability no colisionan (refs distintos)", () => {
    const registry = new GlobalCapabilityRegistry(new GatewayBus());
    registry.sync("agent-aaaaaaaa", [{ deviceId: "simulator-1", capability: CAP }]);
    registry.sync("agent-bbbbbbbb", [{ deviceId: "simulator-1", capability: CAP }]);

    const refs = registry.list().map((c) => c.ref);
    expect(new Set(refs).size).toBe(2);
  });

  it("resolve() encuentra la capability por ref", () => {
    const registry = new GlobalCapabilityRegistry(new GatewayBus());
    registry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);
    const [entry] = registry.list();

    expect(registry.resolve(entry.ref)).toEqual(entry);
    expect(registry.resolve("ref-que-no-existe")).toBeUndefined();
  });

  it("sync() reemplaza el snapshot anterior del mismo agente (no acumula duplicados)", () => {
    const registry = new GlobalCapabilityRegistry(new GatewayBus());
    registry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);
    registry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);

    expect(registry.list()).toHaveLength(1);
  });

  it("removeAgent() elimina todas sus capabilities del catálogo", () => {
    const registry = new GlobalCapabilityRegistry(new GatewayBus());
    registry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);
    registry.sync("agent-2", [{ deviceId: "simulator-2", capability: CAP }]);

    registry.removeAgent("agent-1");

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].edgeAgentId).toBe("agent-2");
  });

  it("emite capability.synced con el conteo correcto", () => {
    const bus = new GatewayBus();
    const events: Array<{ edgeAgentId: string; count: number }> = [];
    bus.on("capability.synced", (payload) => events.push(payload));

    const registry = new GlobalCapabilityRegistry(bus);
    registry.sync("agent-1", [
      { deviceId: "simulator-1", capability: CAP },
      { deviceId: "simulator-1", capability: { ...CAP, name: "toggle_led" } },
    ]);

    expect(events).toEqual([{ edgeAgentId: "agent-1", count: 2 }]);
  });
});
