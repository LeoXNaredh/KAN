import { describe, expect, it, vi } from "vitest";
import { GatewayBus } from "./GatewayBus";
import { AgentRegistry } from "./AgentRegistry";
import type { AgentRecord } from "../domain/entities/AgentRecord";

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    edgeAgentId: "agent-1",
    status: "offline",
    protocolVersion: "1.0.0",
    installedPlugins: [],
    devices: [],
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AgentRegistry", () => {
  it("upsert() registra un agente consultable por get()/list()", () => {
    const registry = new AgentRegistry(new GatewayBus());
    registry.upsert(record());

    expect(registry.get("agent-1")?.edgeAgentId).toBe("agent-1");
    expect(registry.list()).toHaveLength(1);
  });

  it("markOnline() marca status=online y emite agent.connected", () => {
    const bus = new GatewayBus();
    const handler = vi.fn();
    bus.on("agent.connected", handler);
    const registry = new AgentRegistry(bus);
    registry.upsert(record());

    registry.markOnline("agent-1");

    expect(registry.get("agent-1")?.status).toBe("online");
    expect(handler).toHaveBeenCalledWith({ edgeAgentId: "agent-1" });
  });

  it("markOffline() marca status=offline y emite agent.disconnected", () => {
    const bus = new GatewayBus();
    const handler = vi.fn();
    bus.on("agent.disconnected", handler);
    const registry = new AgentRegistry(bus);
    registry.upsert(record({ status: "online" }));

    registry.markOffline("agent-1");

    expect(registry.get("agent-1")?.status).toBe("offline");
    expect(handler).toHaveBeenCalledWith({ edgeAgentId: "agent-1" });
  });

  it("markOnline() de un agente nunca registrado no lanza (solo emite el evento)", () => {
    const registry = new AgentRegistry(new GatewayBus());
    expect(() => registry.markOnline("nunca-existio")).not.toThrow();
    expect(registry.get("nunca-existio")).toBeUndefined();
  });

  it("get() de un agente desconocido devuelve undefined", () => {
    const registry = new AgentRegistry(new GatewayBus());
    expect(registry.get("no-existe")).toBeUndefined();
  });

  describe("list(requestingUserId) — filtro por owner (P2 incremento 4)", () => {
    it("sin requestingUserId, devuelve todo sin filtrar (retrocompatible)", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "sin-owner" }));
      registry.upsert(record({ edgeAgentId: "de-otro", ownerId: "user-2" }));

      expect(registry.list().map((r) => r.edgeAgentId).sort()).toEqual(["de-otro", "sin-owner"]);
    });

    it("con requestingUserId, incluye agentes sin owner y los propios, excluye los de otros", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "sin-owner" }));
      registry.upsert(record({ edgeAgentId: "mio", ownerId: "user-1" }));
      registry.upsert(record({ edgeAgentId: "de-otro", ownerId: "user-2" }));

      expect(registry.list("user-1").map((r) => r.edgeAgentId).sort()).toEqual(["mio", "sin-owner"]);
    });
  });
});
