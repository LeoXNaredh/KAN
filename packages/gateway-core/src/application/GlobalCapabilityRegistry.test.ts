import { describe, expect, it } from "vitest";
import type { CapabilityDescriptor } from "@kan/plugin-contract";
import { GatewayBus } from "./GatewayBus";
import { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";
import { AgentRegistry } from "./AgentRegistry";
import type { AgentRecord } from "../domain/entities/AgentRecord";

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

  describe("list(requestingUserId) — filtro por owner (P2 incremento 4)", () => {
    function agentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
      return {
        edgeAgentId: "agent-1",
        status: "online",
        protocolVersion: "1.0.0",
        installedPlugins: [],
        devices: [],
        lastSeenAt: new Date().toISOString(),
        ...overrides,
      };
    }

    it("sin agentRegistry inyectado, no filtra (comportamiento anterior a este incremento)", () => {
      const registry = new GlobalCapabilityRegistry(new GatewayBus());
      registry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);

      expect(registry.list("cualquier-usuario")).toHaveLength(1);
    });

    it("con agentRegistry inyectado pero sin requestingUserId, no filtra", () => {
      const bus = new GatewayBus();
      const agentRegistry = new AgentRegistry(bus);
      agentRegistry.upsert(agentRecord({ edgeAgentId: "agent-1", ownerId: "user-1" }));
      const registry = new GlobalCapabilityRegistry(bus, agentRegistry);
      registry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);

      expect(registry.list()).toHaveLength(1);
    });

    it("incluye capabilities de agentes sin owner y las del propio usuario, excluye las de otros", () => {
      const bus = new GatewayBus();
      const agentRegistry = new AgentRegistry(bus);
      agentRegistry.upsert(agentRecord({ edgeAgentId: "sin-owner" }));
      agentRegistry.upsert(agentRecord({ edgeAgentId: "mio", ownerId: "user-1" }));
      agentRegistry.upsert(agentRecord({ edgeAgentId: "de-otro", ownerId: "user-2" }));
      const registry = new GlobalCapabilityRegistry(bus, agentRegistry);
      registry.sync("sin-owner", [{ deviceId: "simulator-1", capability: CAP }]);
      registry.sync("mio", [{ deviceId: "simulator-2", capability: CAP }]);
      registry.sync("de-otro", [{ deviceId: "simulator-3", capability: CAP }]);

      const edgeAgentIds = registry.list("user-1").map((c) => c.edgeAgentId).sort();
      expect(edgeAgentIds).toEqual(["mio", "sin-owner"]);
    });

    it("resolve() no filtra por owner — TaskOrchestrator.submit() lo necesita sin concepto de 'quién pregunta'", () => {
      const bus = new GatewayBus();
      const agentRegistry = new AgentRegistry(bus);
      agentRegistry.upsert(agentRecord({ edgeAgentId: "de-otro", ownerId: "user-2" }));
      const registry = new GlobalCapabilityRegistry(bus, agentRegistry);
      registry.sync("de-otro", [{ deviceId: "simulator-1", capability: CAP }]);
      const [entry] = registry.list();

      expect(registry.resolve(entry.ref)).toEqual(entry);
    });
  });
});
