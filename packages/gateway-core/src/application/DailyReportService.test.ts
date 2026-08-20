import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { UserPreference, UserPreferencesPort } from "@kan/core";
import { DailyReportService } from "./DailyReportService";
import { AuditService } from "./AuditService";
import { AgentRegistry } from "./AgentRegistry";
import { GatewayBus } from "./GatewayBus";
import type { AuditEntry } from "../domain/entities/AuditEntry";
import type { AuditStorePort } from "../domain/ports/AuditStorePort";
import type { EmailServicePort, EmailMessage } from "../domain/ports/EmailServicePort";

const NOW = new Date("2026-01-15T14:00:00.000Z"); // hora UTC 14

class InMemoryAuditStore implements AuditStorePort {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(filter?: Partial<Pick<AuditEntry, "userId">>): Promise<AuditEntry[]> {
    return filter?.userId ? this.entries.filter((e) => e.userId === filter.userId) : this.entries;
  }
}

class FakeUserPreferencesStore implements UserPreferencesPort {
  rows: UserPreference[] = [];
  async list(userId: string): Promise<UserPreference[]> {
    return this.rows.filter((r) => r.userId === userId);
  }
  async get(userId: string, key: string): Promise<UserPreference | undefined> {
    return this.rows.find((r) => r.userId === userId && r.key === key);
  }
  async set(userId: string, key: string, value: unknown): Promise<UserPreference> {
    const pref = { userId, key, value, updatedAt: new Date().toISOString() };
    this.rows = [...this.rows.filter((r) => !(r.userId === userId && r.key === key)), pref];
    return pref;
  }
  async remove(userId: string, key: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.key === key));
  }
  async listAllForKey(key: string): Promise<UserPreference[]> {
    return this.rows.filter((r) => r.key === key);
  }
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: crypto.randomUUID(),
    at: NOW.toISOString(),
    actor: "system",
    action: "tool.execute.result",
    subject: "c_agent1_d1_setBrightness",
    metadata: {},
    userId: "user-1",
    ...overrides,
  };
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function setup() {
  const bus = new GatewayBus();
  const auditStore = new InMemoryAuditStore();
  const auditService = new AuditService(auditStore, bus);
  const agentRegistry = new AgentRegistry(bus);
  const preferences = new FakeUserPreferencesStore();
  const sent: EmailMessage[] = [];
  const emailService: EmailServicePort = { send: vi.fn(async (message) => void sent.push(message)) };
  const resolveUserEmail = vi.fn(async (userId: string) => (userId === "user-1" ? "dueno@example.com" : undefined));

  agentRegistry.upsert({
    edgeAgentId: "agent-1",
    status: "online",
    protocolVersion: "1.0.0",
    installedPlugins: [],
    devices: [],
    lastSeenAt: NOW.toISOString(),
    ownerId: "user-1",
  });

  return { auditStore, auditService, agentRegistry, preferences, emailService, resolveUserEmail, sent };
}

describe("DailyReportService", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dueño con dailyReportEnabled y la hora configurada = hora actual: manda el email con el resumen de las últimas 24h", async () => {
    const { auditStore, auditService, agentRegistry, preferences, emailService, resolveUserEmail, sent } = setup();
    preferences.rows = [
      { userId: "user-1", key: "dailyReportEnabled", value: true, updatedAt: NOW.toISOString() },
      { userId: "user-1", key: "dailyReportHour", value: 14, updatedAt: NOW.toISOString() },
    ];
    auditStore.entries = [
      entry({ action: "alert.triggered", at: hoursAgo(2), metadata: { body: "La temperatura llegó a 43 grados, superó el límite.", capabilityRef: "c_agent1_d1_temp" } }),
      entry({ action: "tool.execute.result", at: hoursAgo(1), metadata: { success: true } }),
      entry({ action: "tool.execute.result", at: hoursAgo(1), metadata: { success: false, error: "timeout" } }),
      // Fuera de la ventana de 24h — no debe contarse.
      entry({ action: "tool.execute.result", at: hoursAgo(30), metadata: { success: true } }),
    ];

    const service = new DailyReportService(auditService, agentRegistry, emailService, preferences, resolveUserEmail, "https://kan.example.com");
    service.start();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    service.stop();

    expect(resolveUserEmail).toHaveBeenCalledWith("user-1");
    expect(sent[0].to).toBe("dueno@example.com");
    expect(sent[0].subject).toMatch(/^KAN — Resumen del día/);
    expect(sent[0].text).toContain("Alertas disparadas: 1");
    expect(sent[0].text).toContain("La temperatura llegó a 43 grados");
    expect(sent[0].text).toContain("Sensores fuera de rango: c_agent1_d1_temp");
    expect(sent[0].text).toContain("Acciones ejecutadas: 2 (1 exitosas, 1 fallidas)");
    expect(sent[0].text).toContain("https://kan.example.com/inicio");
  });

  it("dailyReportEnabled=false: no manda nada", async () => {
    const { preferences, auditService, agentRegistry, emailService, resolveUserEmail, sent } = setup();
    preferences.rows = [{ userId: "user-1", key: "dailyReportEnabled", value: false, updatedAt: NOW.toISOString() }];

    const service = new DailyReportService(auditService, agentRegistry, emailService, preferences, resolveUserEmail, "https://kan.example.com", undefined, 20);
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    service.stop();

    expect(sent).toHaveLength(0);
  });

  it("enabled pero sin dailyReportHour configurada: usa el default (9) — no manda si la hora actual no es 9", async () => {
    const { preferences, auditService, agentRegistry, emailService, resolveUserEmail, sent } = setup();
    preferences.rows = [{ userId: "user-1", key: "dailyReportEnabled", value: true, updatedAt: NOW.toISOString() }];
    // NOW está fijado a las 14 UTC — el default (9) no matchea.

    const service = new DailyReportService(auditService, agentRegistry, emailService, preferences, resolveUserEmail, "https://kan.example.com", undefined, 20);
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    service.stop();

    expect(sent).toHaveLength(0);
  });

  it("no manda dos veces el mismo día aunque el timer vuelva a disparar", async () => {
    const { preferences, auditStore, auditService, agentRegistry, emailService, resolveUserEmail, sent } = setup();
    preferences.rows = [
      { userId: "user-1", key: "dailyReportEnabled", value: true, updatedAt: NOW.toISOString() },
      { userId: "user-1", key: "dailyReportHour", value: 14, updatedAt: NOW.toISOString() },
    ];
    auditStore.entries = [];

    const service = new DailyReportService(auditService, agentRegistry, emailService, preferences, resolveUserEmail, "https://kan.example.com", undefined, 20);
    service.start();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 80));
    service.stop();

    expect(sent).toHaveLength(1);
  });

  it("sin email resoluble para el dueño, no lanza y se saltea", async () => {
    const { preferences, auditService, agentRegistry, emailService, sent } = setup();
    preferences.rows = [
      { userId: "user-1", key: "dailyReportEnabled", value: true, updatedAt: NOW.toISOString() },
      { userId: "user-1", key: "dailyReportHour", value: 14, updatedAt: NOW.toISOString() },
    ];
    const resolveUserEmail = vi.fn(async () => undefined);

    const service = new DailyReportService(auditService, agentRegistry, emailService, preferences, resolveUserEmail, "https://kan.example.com", undefined, 20);
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    service.stop();

    expect(sent).toHaveLength(0);
  });

  it("dueño sin ningún Edge Agent propio: no manda nada (nada que reportar)", async () => {
    const bus = new GatewayBus();
    const auditStore = new InMemoryAuditStore();
    const auditService = new AuditService(auditStore, bus);
    const agentRegistry = new AgentRegistry(bus); // sin agentes
    const preferences = new FakeUserPreferencesStore();
    preferences.rows = [
      { userId: "user-1", key: "dailyReportEnabled", value: true, updatedAt: NOW.toISOString() },
      { userId: "user-1", key: "dailyReportHour", value: 14, updatedAt: NOW.toISOString() },
    ];
    const sent: EmailMessage[] = [];
    const emailService: EmailServicePort = { send: vi.fn(async (message) => void sent.push(message)) };
    const resolveUserEmail = vi.fn(async () => "dueno@example.com");

    const service = new DailyReportService(auditService, agentRegistry, emailService, preferences, resolveUserEmail, "https://kan.example.com", undefined, 20);
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    service.stop();

    expect(sent).toHaveLength(0);
  });
});
