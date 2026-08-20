import { describe, expect, it, vi } from "vitest";
import { GatewayBus } from "./GatewayBus";
import { AgentRegistry } from "./AgentRegistry";
import type { AgentRecord } from "../domain/entities/AgentRecord";
import type { AgentRegistryStorePort } from "../domain/ports/AgentRegistryStorePort";

class FakeAgentRegistryStore implements AgentRegistryStorePort {
  records = new Map<string, AgentRecord>();
  saveCalls: AgentRecord[] = [];
  removeCalls: string[] = [];

  load(): AgentRecord[] {
    return Array.from(this.records.values());
  }
  save(record: AgentRecord): void {
    this.records.set(record.edgeAgentId, { ...record });
    this.saveCalls.push({ ...record });
  }
  remove(edgeAgentId: string): void {
    this.records.delete(edgeAgentId);
    this.removeCalls.push(edgeAgentId);
  }
}

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

  describe("pruneStaleOffline() — limpieza de entradas huérfanas (fix de auditoría de backend)", () => {
    const NINETY_ONE_DAYS_AGO = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    it("al conectar un agente nuevo, poda un registro offline con lastSeenAt de hace más de 90 días", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "reinstalado-viejo", status: "offline", lastSeenAt: NINETY_ONE_DAYS_AGO }));

      registry.upsert(record({ edgeAgentId: "agente-nuevo" }));

      expect(registry.get("reinstalado-viejo")).toBeUndefined();
      expect(registry.get("agente-nuevo")).toBeDefined();
    });

    it("no poda un registro offline reciente — 'la laptop está apagada' no es 'ya no existe'", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "laptop-2", status: "offline", lastSeenAt: ONE_DAY_AGO }));

      registry.upsert(record({ edgeAgentId: "agente-nuevo" }));

      expect(registry.get("laptop-2")).toBeDefined();
    });

    it("nunca poda un registro online, sin importar lastSeenAt", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "online-viejo", status: "online", lastSeenAt: NINETY_ONE_DAYS_AGO }));

      registry.upsert(record({ edgeAgentId: "agente-nuevo" }));

      expect(registry.get("online-viejo")).toBeDefined();
    });

    it("no podía a un mismo owner con dos dispositivos, uno offline reciente y otro online", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "laptop-oficina", ownerId: "user-1", status: "online" }));
      registry.upsert(record({ edgeAgentId: "laptop-casa", ownerId: "user-1", status: "offline", lastSeenAt: ONE_DAY_AGO }));

      expect(registry.list("user-1").map((r) => r.edgeAgentId).sort()).toEqual(["laptop-casa", "laptop-oficina"]);
    });
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

  describe("hasAccess()/setGrantedUserIds() — acceso multi-usuario", () => {
    it("sin ownerId (agente sin vincular), cualquiera tiene acceso", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "sin-owner" }));

      expect(registry.hasAccess("sin-owner", "cualquiera")).toBe(true);
    });

    it("el dueño siempre tiene acceso, sin necesidad de un grant", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "mio", ownerId: "user-1" }));

      expect(registry.hasAccess("mio", "user-1")).toBe(true);
    });

    it("sin grant, un usuario que no es el dueño no tiene acceso", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "de-otro", ownerId: "user-1" }));

      expect(registry.hasAccess("de-otro", "user-2")).toBe(false);
    });

    it("setGrantedUserIds() da acceso a un usuario invitado, sin tocar el ownerId", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "compartido", ownerId: "user-1" }));

      registry.setGrantedUserIds("compartido", ["user-2"]);

      expect(registry.hasAccess("compartido", "user-2")).toBe(true);
      expect(registry.hasAccess("compartido", "user-3")).toBe(false);
      expect(registry.get("compartido")?.ownerId).toBe("user-1");
    });

    it("volver a llamar setGrantedUserIds() reemplaza la lista anterior (revocar es inmediato)", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "compartido", ownerId: "user-1" }));
      registry.setGrantedUserIds("compartido", ["user-2"]);

      registry.setGrantedUserIds("compartido", []);

      expect(registry.hasAccess("compartido", "user-2")).toBe(false);
    });

    it("getGrantedUserIds() devuelve la lista de invitados (usada para el fan-out de notificaciones de alertas)", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "compartido", ownerId: "user-1" }));

      expect(registry.getGrantedUserIds("compartido")).toEqual([]);

      registry.setGrantedUserIds("compartido", ["user-2", "user-3"]);
      expect(registry.getGrantedUserIds("compartido")).toEqual(["user-2", "user-3"]);
    });

    it("list(requestingUserId) incluye agentes con grant, además de propios y sin owner", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record({ edgeAgentId: "sin-owner" }));
      registry.upsert(record({ edgeAgentId: "mio", ownerId: "user-1" }));
      registry.upsert(record({ edgeAgentId: "compartido-conmigo", ownerId: "user-2" }));
      registry.upsert(record({ edgeAgentId: "de-otro", ownerId: "user-3" }));
      registry.setGrantedUserIds("compartido-conmigo", ["user-1"]);

      const ids = registry.list("user-1").map((r) => r.edgeAgentId).sort();
      expect(ids).toEqual(["compartido-conmigo", "mio", "sin-owner"]);
    });
  });

  describe("con store (fix de auditoría de backend #2)", () => {
    it("hidrata desde store.load() al construirse", () => {
      const store = new FakeAgentRegistryStore();
      store.records.set("agent-1", record({ edgeAgentId: "agent-1", status: "offline" }));

      const registry = new AgentRegistry(new GatewayBus(), store);

      expect(registry.get("agent-1")?.edgeAgentId).toBe("agent-1");
    });

    it("un registro hidratado como 'online' se corrige a 'offline' — la conexión WS murió con el proceso anterior", () => {
      const store = new FakeAgentRegistryStore();
      store.records.set("agent-1", record({ edgeAgentId: "agent-1", status: "online" }));

      const registry = new AgentRegistry(new GatewayBus(), store);

      expect(registry.get("agent-1")?.status).toBe("offline");
    });

    it("upsert()/markOnline()/markOffline() persisten en el store", () => {
      const store = new FakeAgentRegistryStore();
      const registry = new AgentRegistry(new GatewayBus(), store);

      registry.upsert(record({ edgeAgentId: "agent-1", status: "offline" }));
      registry.markOnline("agent-1");
      registry.markOffline("agent-1");

      expect(store.saveCalls.map((r) => r.status)).toEqual(["offline", "online", "offline"]);
    });

    it("pruneStaleOffline() también borra del store", () => {
      const store = new FakeAgentRegistryStore();
      const registry = new AgentRegistry(new GatewayBus(), store);
      const NINETY_ONE_DAYS_AGO = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      registry.upsert(record({ edgeAgentId: "viejo", status: "offline", lastSeenAt: NINETY_ONE_DAYS_AGO }));

      registry.upsert(record({ edgeAgentId: "nuevo" }));

      expect(store.removeCalls).toContain("viejo");
    });

    it("sin store, se comporta exactamente igual que antes (retrocompatible)", () => {
      const registry = new AgentRegistry(new GatewayBus());
      registry.upsert(record());
      expect(registry.get("agent-1")?.edgeAgentId).toBe("agent-1");
    });
  });
});
