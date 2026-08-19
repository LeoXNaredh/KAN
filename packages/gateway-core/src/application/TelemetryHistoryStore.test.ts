import { describe, expect, it } from "vitest";
import { TelemetryHistoryStore, type TelemetryReading } from "./TelemetryHistoryStore";
import { GatewayBus } from "./GatewayBus";
import { AgentRegistry } from "./AgentRegistry";
import type { AgentRecord } from "../domain/entities/AgentRecord";

function reading(overrides: Partial<TelemetryReading> = {}): TelemetryReading {
  return {
    edgeAgentId: "agent-1",
    deviceName: "Sensor de invernadero",
    description: "Lee la temperatura",
    value: 23.4,
    at: new Date().toISOString(),
    ...overrides,
  };
}

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

describe("TelemetryHistoryStore", () => {
  it("history() devuelve las lecturas grabadas para un ref, vacío para uno desconocido", () => {
    const store = new TelemetryHistoryStore();
    store.record("c_1_read_temp", reading({ value: 20 }));
    store.record("c_1_read_temp", reading({ value: 21 }));

    expect(store.history("c_1_read_temp")).toHaveLength(2);
    expect(store.history("c_1_read_temp").map((r) => r.value)).toEqual([20, 21]);
    expect(store.history("ref-que-no-existe")).toEqual([]);
  });

  it("cap en 200 lecturas por ref — descarta la más vieja (ring buffer)", () => {
    const store = new TelemetryHistoryStore();
    for (let i = 0; i < 205; i++) {
      store.record("c_1_read_temp", reading({ value: i }));
    }

    const history = store.history("c_1_read_temp");
    expect(history).toHaveLength(200);
    expect(history[0].value).toBe(5); // las primeras 5 (0..4) se descartaron
    expect(history[199].value).toBe(204);
  });

  it("list() devuelve un resumen por ref con la última lectura", () => {
    const store = new TelemetryHistoryStore();
    store.record("c_1_read_temp", reading({ value: 20 }));
    store.record("c_1_read_temp", reading({ value: 21 }));
    store.record("c_2_read_level", reading({ value: 5, deviceName: "Tanque" }));

    const list = store.list();
    expect(list).toHaveLength(2);
    const temp = list.find((s) => s.ref === "c_1_read_temp");
    expect(temp?.latest.value).toBe(21);
  });

  describe("filtro por owner (mismo criterio que GlobalCapabilityRegistry)", () => {
    it("sin agentRegistry inyectado, no filtra", () => {
      const store = new TelemetryHistoryStore();
      store.record("c_1_read_temp", reading());

      expect(store.history("c_1_read_temp", "cualquier-usuario")).toHaveLength(1);
      expect(store.list("cualquier-usuario")).toHaveLength(1);
    });

    it("con agentRegistry pero sin requestingUserId, no filtra", () => {
      const bus = new GatewayBus();
      const agentRegistry = new AgentRegistry(bus);
      agentRegistry.upsert(agentRecord({ edgeAgentId: "agent-1", ownerId: "user-1" }));
      const store = new TelemetryHistoryStore(agentRegistry);
      store.record("c_1_read_temp", reading({ edgeAgentId: "agent-1" }));

      expect(store.history("c_1_read_temp")).toHaveLength(1);
      expect(store.list()).toHaveLength(1);
    });

    it("filtra history()/list() por dueño, incluye agentes sin owner", () => {
      const bus = new GatewayBus();
      const agentRegistry = new AgentRegistry(bus);
      agentRegistry.upsert(agentRecord({ edgeAgentId: "mio", ownerId: "user-1" }));
      agentRegistry.upsert(agentRecord({ edgeAgentId: "de-otro", ownerId: "user-2" }));
      agentRegistry.upsert(agentRecord({ edgeAgentId: "sin-owner" }));
      const store = new TelemetryHistoryStore(agentRegistry);
      store.record("c_mio", reading({ edgeAgentId: "mio" }));
      store.record("c_otro", reading({ edgeAgentId: "de-otro" }));
      store.record("c_sin_owner", reading({ edgeAgentId: "sin-owner" }));

      expect(store.history("c_mio", "user-1")).toHaveLength(1);
      expect(store.history("c_otro", "user-1")).toEqual([]);
      expect(store.history("c_sin_owner", "user-1")).toHaveLength(1);

      const refs = store.list("user-1").map((s) => s.ref).sort();
      expect(refs).toEqual(["c_mio", "c_sin_owner"]);
    });

    it("sigue filtrando por dueño incluso después de que el agente se desconecta (markOffline no borra ownerId)", () => {
      const bus = new GatewayBus();
      const agentRegistry = new AgentRegistry(bus);
      agentRegistry.upsert(agentRecord({ edgeAgentId: "de-otro", ownerId: "user-2" }));
      const store = new TelemetryHistoryStore(agentRegistry);
      store.record("c_otro", reading({ edgeAgentId: "de-otro" }));

      agentRegistry.markOffline("de-otro");

      expect(store.history("c_otro", "user-1")).toEqual([]);
      expect(store.history("c_otro", "user-2")).toHaveLength(1);
    });
  });
});
