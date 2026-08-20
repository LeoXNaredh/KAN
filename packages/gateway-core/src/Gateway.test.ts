import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { CoreToEdgeMessage, EdgeToCoreMessage, HelloMessage } from "@kan/plugin-contract";
import { GatewayBus } from "./application/GatewayBus";
import { Gateway } from "./Gateway";
import { SCHEDULER_TOOL_DESCRIPTORS } from "./application/schedulerTools";
import { ALERT_TOOL_DESCRIPTORS } from "./application/alertTools";
import { SEQUENCE_TOOL_DESCRIPTORS } from "./application/sequenceTools";
import type { AgentConnectionInfo, ConnectionManagerPort, Unsubscribe } from "./domain/ports/ConnectionManagerPort";
import type { AuditStorePort } from "./domain/ports/AuditStorePort";
import type { SchedulerDispatch, SchedulerPort } from "./domain/ports/SchedulerPort";
import type { NotificationServicePort } from "./domain/ports/NotificationServicePort";
import type { Notification } from "./domain/entities/Notification";
import type { AuditEntry } from "./domain/entities/AuditEntry";

const AUTOMATION_TOOL_COUNT =
  SCHEDULER_TOOL_DESCRIPTORS.length + ALERT_TOOL_DESCRIPTORS.length + SEQUENCE_TOOL_DESCRIPTORS.length;

/**
 * Fake de todo el transporte (no WS real — eso ya lo cubre
 * WsConnectionManager.test.ts). Simula el otro lado: un Edge Agent que se
 * conecta, envía hello, y responde con telemetría cuando el Gateway le
 * despacha un AgentTaskDispatchMessage — exactamente el ciclo que hace
 * EdgeAgent.ts en la vida real (docs/07-arquitectura-comunicacion.md).
 */
class FakeConnectionManager implements ConnectionManagerPort {
  private connectedHandlers: Array<(info: AgentConnectionInfo) => void> = [];
  private messageHandlers: Array<(edgeAgentId: string, message: EdgeToCoreMessage) => void> = [];
  readonly dispatched: CoreToEdgeMessage[] = [];

  start(): void {}
  stop(): void {}

  send(_edgeAgentId: string, message: CoreToEdgeMessage): boolean {
    this.dispatched.push(message);
    return true;
  }

  onAgentConnected(handler: (info: AgentConnectionInfo) => void): Unsubscribe {
    this.connectedHandlers.push(handler);
    return () => {};
  }
  onAgentDisconnected(): Unsubscribe {
    return () => {};
  }
  onMessage(handler: (edgeAgentId: string, message: EdgeToCoreMessage) => void): Unsubscribe {
    this.messageHandlers.push(handler);
    return () => {};
  }
  getState(): "connected" | "disconnected" {
    return "connected";
  }

  /** Simula que un Edge Agent real se conecta y manda su hello. */
  simulateAgentConnect(hello: HelloMessage, ownerId?: string): void {
    const info: AgentConnectionInfo = {
      edgeAgentId: hello.edgeAgentId,
      protocolVersion: hello.protocolVersion,
      connectedAt: new Date().toISOString(),
      hello,
      ownerId,
    };
    this.connectedHandlers.forEach((handler) => handler(info));
  }

  /** Simula que el Edge Agent responde con telemetría a un dispatch. */
  simulateTelemetry(edgeAgentId: string, message: EdgeToCoreMessage): void {
    this.messageHandlers.forEach((handler) => handler(edgeAgentId, message));
  }
}

class InMemoryAuditStore implements AuditStorePort {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<AuditEntry[]> {
    return this.entries;
  }
}

class FakeSchedulerStub implements SchedulerPort {
  dispatch: SchedulerDispatch | undefined;
  stopped = false;

  schedule(): string {
    return "unused";
  }
  cancel(): void {}
  list() {
    return [];
  }
  start(dispatch: SchedulerDispatch): void {
    this.dispatch = dispatch;
  }
  stop(): void {
    this.stopped = true;
  }
}

class RecordingNotificationStub implements NotificationServicePort {
  readonly sent: Notification[] = [];
  async notify(notification: Notification): Promise<void> {
    this.sent.push(notification);
  }
}

function buildGateway(
  overrides: { speakToUser?: (userId: string, text: string) => boolean; alertPollIntervalMs?: number } = {},
) {
  const bus = new GatewayBus();
  const connectionManager = new FakeConnectionManager();
  const auditStore = new InMemoryAuditStore();
  const scheduler = new FakeSchedulerStub();
  const notificationService = new RecordingNotificationStub();
  const gateway = new Gateway({
    bus,
    connectionManager,
    auditStore,
    scheduler,
    notificationService,
    speakToUser: overrides.speakToUser,
    alertPollIntervalMs: overrides.alertPollIntervalMs,
  });
  gateway.bootstrap();
  return { gateway, connectionManager, auditStore, bus, scheduler, notificationService };
}

function helloFor(edgeAgentId: string): HelloMessage {
  return {
    type: "hello",
    protocolVersion: "1.0.0",
    edgeAgentId,
    os: "win32",
    agentVersion: "0.1.0",
    installedPlugins: [
      {
        id: "kan-plugin-device-simulator",
        version: "0.1.0",
        displayName: "Simulador",
        kind: "device-driver",
        runtime: "in-process-ts",
        permissions: { devices: ["device-simulator"], network: false, filesystem: [] },
      },
    ],
    capabilities: [
      {
        deviceId: "simulator-1",
        deviceName: "Dispositivo Simulado #1",
        deviceKind: "device-simulator",
        capability: { name: "read_sensor", description: "...", severity: "read-only", supportsDryRun: false },
      },
    ],
  };
}

/**
 * Multi-dispositivo coordinado (kan_run_sequence/AlertRule.steps) — el
 * sensor de `helloFor` (para el chequeo de umbral de una alerta) más dos
 * dispositivos reales para coordinar (para la secuencia en sí).
 */
function helloForSensorMotorAndLed(edgeAgentId: string): HelloMessage {
  const base = helloFor(edgeAgentId);
  return {
    ...base,
    capabilities: [
      ...base.capabilities,
      {
        deviceId: "motor-1",
        deviceName: "Motor del taller",
        deviceKind: "device-simulator",
        capability: { name: "toggle_motor", description: "Prende o apaga el motor", severity: "irreversible-material", supportsDryRun: false },
      },
      {
        deviceId: "led-1",
        deviceName: "LED de alerta",
        deviceKind: "device-simulator",
        capability: { name: "toggle_led", description: "Prende o apaga el LED", severity: "reversible", supportsDryRun: false },
      },
    ],
  };
}

function findToolByDevice(tools: { name: string }[], deviceId: string): { name: string } {
  const tool = tools.find((t) => t.name.includes(deviceId));
  if (!tool) throw new Error(`No se encontró ninguna tool para el dispositivo "${deviceId}" — revisá el fixture del test.`);
  return tool;
}

/** A nivel de módulo (no solo dentro de "resolveConfirmation()") — también la usa "listPendingConfirmations()". */
async function buildPendingConfirmation() {
  const { gateway, connectionManager, auditStore } = buildGateway();
  const edgeAgentId = randomUUID();
  connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");
  const [tool] = gateway.listTools();

  const executePromise = gateway.executeTool(tool.name, {}, "user-1");
  const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
  connectionManager.simulateTelemetry(edgeAgentId, {
    type: "telemetry",
    taskId,
    status: "pending_confirmation",
    confirmationId: "conf-web-1",
    at: new Date().toISOString(),
  });
  const result = await executePromise;
  connectionManager.dispatched.length = 0;

  return { gateway, connectionManager, auditStore, edgeAgentId, pendingResult: result };
}

describe("Gateway (integración, transporte simulado)", () => {
  it("el ownerId resuelto en la conexión (docs/19 P2, incremento 3) queda en el AgentRecord", async () => {
    const { gateway, connectionManager } = buildGateway();
    const edgeAgentId = randomUUID();

    connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");

    expect(gateway.agentRegistry.get(edgeAgentId)?.ownerId).toBe("user-1");
  });

  it("sin ownerId resuelto (agente no vinculado todavía), el AgentRecord queda con ownerId undefined", async () => {
    const { gateway, connectionManager } = buildGateway();
    const edgeAgentId = randomUUID();

    connectionManager.simulateAgentConnect(helloFor(edgeAgentId));

    expect(gateway.agentRegistry.get(edgeAgentId)?.ownerId).toBeUndefined();
  });

  describe("executeTool() — autorización por owner (docs/19 P2, incremento 4)", () => {
    it("rechaza sin tocar el Edge Agent si el agente está vinculado a otro usuario", async () => {
      const { gateway, connectionManager } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");

      const [tool] = gateway.listTools();
      const result = await gateway.executeTool(tool.name, {}, "user-2");

      expect(result).toEqual({ success: false, error: "No autorizado: este dispositivo pertenece a otro usuario." });
      expect(connectionManager.dispatched).toHaveLength(0);
    });

    it("permite la ejecución cuando el requestingUserId coincide con el ownerId del agente", async () => {
      const { gateway, connectionManager } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");

      const [tool] = gateway.listTools();
      const executePromise = gateway.executeTool(tool.name, {}, "user-1");

      expect(connectionManager.dispatched).toHaveLength(1);
      const dispatchedTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId: dispatchedTaskId,
        status: "done",
        data: {},
        at: new Date().toISOString(),
      });
      expect((await executePromise).success).toBe(true);
    });

    it("un agente sin vincular (sin ownerId) sigue abierto para cualquiera, con o sin requestingUserId", async () => {
      const { gateway, connectionManager } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId));

      const [tool] = gateway.listTools();
      const executePromise = gateway.executeTool(tool.name, {}, "cualquier-usuario");

      expect(connectionManager.dispatched).toHaveLength(1);
      const dispatchedTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId: dispatchedTaskId,
        status: "done",
        data: {},
        at: new Date().toISOString(),
      });
      expect((await executePromise).success).toBe(true);
    });

    it("audita la denegación con actor 'user' y action 'tool.execute.denied'", async () => {
      const { gateway, connectionManager, auditStore } = buildGateway();
      connectionManager.simulateAgentConnect(helloFor(randomUUID()), "user-1");

      const [tool] = gateway.listTools();
      await gateway.executeTool(tool.name, {}, "user-2");

      expect(auditStore.entries).toHaveLength(1);
      expect(auditStore.entries[0]).toMatchObject({
        actor: "user",
        action: "tool.execute.denied",
        subject: tool.name,
        metadata: { requestingUserId: "user-2", ownerId: "user-1" },
      });
    });
  });

  it("ciclo completo: agente conecta -> capability disponible como tool -> ejecutar -> telemetría -> resultado", async () => {
    const { gateway, connectionManager, auditStore } = buildGateway();

    connectionManager.simulateAgentConnect(helloFor(randomUUID()));

    const tools = gateway.listTools();
    // +tools de automatizaciones (ADR-039) y de alertas, siempre presentes.
    expect(tools).toHaveLength(1 + AUTOMATION_TOOL_COUNT);
    expect(tools[0].name).toMatch(/simulator-1.*read_sensor|read_sensor/);

    const agents = gateway.agentRegistry.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].status).toBe("online");
    expect(agents[0].installedPlugins[0].id).toBe("kan-plugin-device-simulator");

    const executePromise = gateway.executeTool(tools[0].name, {});

    expect(connectionManager.dispatched).toHaveLength(1);
    const dispatchedTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;

    connectionManager.simulateTelemetry(agents[0].edgeAgentId, {
      type: "telemetry",
      taskId: dispatchedTaskId,
      status: "done",
      data: { temperatureC: 22.5 },
      at: new Date().toISOString(),
    });

    const result = await executePromise;
    expect(result).toEqual({ success: true, data: { temperatureC: 22.5 }, error: undefined });

    // Toda ejecución de tool queda auditada (docs/12 §6) — la propuesta
    // (antes de ejecutar) más el resultado real (aditivo, DailyReportService).
    expect(auditStore.entries).toHaveLength(2);
    expect(auditStore.entries[0]).toMatchObject({ actor: "llm", action: "tool.execute" });
    expect(auditStore.entries[1]).toMatchObject({ actor: "system", action: "tool.execute.result", metadata: { success: true } });
  });

  it("ejecutar una tool con nombre inventado por el LLM se rechaza antes de tocar el Edge Agent", async () => {
    const { gateway, connectionManager } = buildGateway();
    connectionManager.simulateAgentConnect(helloFor(randomUUID()));

    const result = await gateway.executeTool("tool_que_no_existe", {});

    expect(result.success).toBe(false);
    expect(connectionManager.dispatched).toHaveLength(0);
  });

  it("al desconectar un agente, sus capabilities desaparecen del catálogo de tools", () => {
    const { gateway, bus } = buildGateway();
    const edgeAgentId = randomUUID();

    const events: string[] = [];
    bus.on("agent.disconnected", ({ edgeAgentId }) => events.push(edgeAgentId));

    gateway.agentRegistry.upsert({
      edgeAgentId,
      status: "online",
      protocolVersion: "1.0.0",
      installedPlugins: [],
      devices: [],
      lastSeenAt: new Date().toISOString(),
    });
    gateway.capabilityRegistry.sync(edgeAgentId, [
      { deviceId: "d1", capability: { name: "cap1", description: "...", severity: "read-only", supportsDryRun: false } },
    ]);
    // +tools de automatizaciones (ADR-039) y de alertas, siempre presentes con o sin agentes conectados.
    expect(gateway.listTools()).toHaveLength(1 + AUTOMATION_TOOL_COUNT);

    gateway.agentRegistry.markOffline(edgeAgentId);
    gateway.capabilityRegistry.removeAgent(edgeAgentId);

    expect(gateway.listTools()).toHaveLength(AUTOMATION_TOOL_COUNT);
    expect(events).toContain(edgeAgentId);
  });

  it("registra en auditoría incluso cuando la ejecución falla", async () => {
    const { gateway, connectionManager, auditStore } = buildGateway();
    connectionManager.simulateAgentConnect(helloFor(randomUUID()));
    const [tool] = gateway.listTools();

    const executePromise = gateway.executeTool(tool.name, {});
    const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
    connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
      type: "telemetry",
      taskId,
      status: "failed",
      error: "el driver explotó",
      at: new Date().toISOString(),
    });

    const result = await executePromise;
    expect(result).toEqual({ success: false, data: undefined, error: "el driver explotó" });
    expect(auditStore.entries).toHaveLength(2);
    expect(auditStore.entries[1]).toMatchObject({
      action: "tool.execute.result",
      metadata: { success: false, error: "el driver explotó" },
    });
  });

  it("bootstrap() arranca el scheduler; un job de un paso se somete al Task Orchestrator y queda auditado (P6)", async () => {
    const { gateway, connectionManager, auditStore, scheduler } = buildGateway();
    connectionManager.simulateAgentConnect(helloFor(randomUUID()));
    const [tool] = gateway.listTools();

    expect(scheduler.dispatch).toBeDefined();
    const dispatchPromise = scheduler.dispatch!({ id: "job-1", steps: [{ capabilityRef: tool.name, input: {} }] });

    const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
    connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
      type: "telemetry",
      taskId,
      status: "done",
      data: { ok: true },
      at: new Date().toISOString(),
    });

    await dispatchPromise;
    expect(auditStore.entries.map((entry) => entry.action)).toContain("job.fired");
    expect(auditStore.entries.find((entry) => entry.action === "job.fired")).toMatchObject({
      actor: "system",
      subject: tool.name,
      metadata: { jobId: "job-1" },
    });
  });

  it("un job de varias 'acciones combinadas' se detiene en el primer paso que falla, sin ejecutar los siguientes", async () => {
    const { gateway, connectionManager, scheduler, auditStore } = buildGateway();
    connectionManager.simulateAgentConnect(helloFor(randomUUID()));
    const [tool] = gateway.listTools();

    const dispatchPromise = scheduler.dispatch!({
      id: "job-2",
      steps: [
        { capabilityRef: tool.name, input: {} },
        { capabilityRef: tool.name, input: {} },
      ],
    });

    const firstTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
    connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
      type: "telemetry",
      taskId: firstTaskId,
      status: "failed",
      error: "el driver explotó",
      at: new Date().toISOString(),
    });

    await dispatchPromise;

    expect(connectionManager.dispatched).toHaveLength(1);
    expect(auditStore.entries.filter((entry) => entry.action === "job.fired")).toHaveLength(1);
  });

  it("una notificación configurada se dispara después de correr los steps, con severidad según el resultado", async () => {
    const { gateway, connectionManager, scheduler, notificationService, auditStore } = buildGateway();
    connectionManager.simulateAgentConnect(helloFor(randomUUID()));
    const [tool] = gateway.listTools();

    const dispatchPromise = scheduler.dispatch!({
      id: "job-3",
      steps: [{ capabilityRef: tool.name, input: {} }],
      notification: { title: "Riego completado", body: "Se regó el jardín." },
    });

    const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
    connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
      type: "telemetry",
      taskId,
      status: "done",
      data: {},
      at: new Date().toISOString(),
    });

    await dispatchPromise;

    expect(notificationService.sent).toEqual([
      { userId: "system", channel: "chat", title: "Riego completado", body: "Se regó el jardín.", severity: "info" },
    ]);
    expect(auditStore.entries.find((entry) => entry.action === "job.notification")).toMatchObject({
      subject: "Riego completado",
      metadata: { jobId: "job-3", body: "Se regó el jardín.", failed: false },
    });
  });

  it("device.enriched (ADR-053) — Gateway graba la auditoría al recibir el evento del bus, sin conocer a DeviceEnrichmentService directo", async () => {
    const { auditStore, bus } = buildGateway();

    bus.emit("device.enriched", {
      ownerId: "user-1",
      deviceKind: "esp32-arduino",
      summary: "ESP32-WROOM-32: microcontrolador WiFi/BLE, 3.3V.",
      deviceNames: ["ESP32 (COM3)"],
      sources: ["https://example.com/esp32"],
    });

    expect(auditStore.entries.find((entry) => entry.action === "device.enriched")).toMatchObject({
      actor: "system",
      subject: "esp32-arduino",
      userId: "user-1",
      metadata: { deviceNames: ["ESP32 (COM3)"], sources: ["https://example.com/esp32"] },
    });
  });

  it("la notificación de un job con createdBy se manda a ese usuario, no a 'system' (P7)", async () => {
    const { gateway, connectionManager, scheduler, notificationService } = buildGateway();
    connectionManager.simulateAgentConnect(helloFor(randomUUID()));
    const [tool] = gateway.listTools();

    const dispatchPromise = scheduler.dispatch!({
      id: "job-4",
      steps: [{ capabilityRef: tool.name, input: {} }],
      notification: { title: "Riego completado", body: "Se regó el jardín." },
      createdBy: "user-9",
    });

    const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
    connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
      type: "telemetry",
      taskId,
      status: "done",
      data: {},
      at: new Date().toISOString(),
    });

    await dispatchPromise;

    expect(notificationService.sent).toEqual([
      { userId: "user-9", channel: "chat", title: "Riego completado", body: "Se regó el jardín.", severity: "info" },
    ]);
  });

  it("shutdown() detiene el scheduler además del transporte", () => {
    const { gateway, scheduler } = buildGateway();
    gateway.shutdown();
    expect(scheduler.stopped).toBe(true);
  });

  it("un cambio de Safety Policy del Edge Agent queda registrado en la auditoría (regla 7)", () => {
    const { connectionManager, auditStore } = buildGateway();
    const edgeAgentId = randomUUID();
    connectionManager.simulateAgentConnect(helloFor(edgeAgentId));

    connectionManager.simulateTelemetry(edgeAgentId, {
      type: "safety_policy.changed",
      deviceId: "esp32-1",
      target: "5",
      alias: "Relé bomba de agua",
      severity: "irreversible-material",
      previousSeverity: "reversible",
      at: new Date().toISOString(),
    });

    expect(auditStore.entries).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({
      actor: "user",
      action: "safety_policy.changed",
      subject: `${edgeAgentId}/esp32-1/5`,
      metadata: { alias: "Relé bomba de agua", severity: "irreversible-material", previousSeverity: "reversible" },
    });
  });

  it("una invocación manual del Edge Agent (audit.local) queda registrada con actor 'user' (docs/16 P4, ADR-025)", () => {
    const { connectionManager, auditStore } = buildGateway();
    const edgeAgentId = randomUUID();
    connectionManager.simulateAgentConnect(helloFor(edgeAgentId));

    connectionManager.simulateTelemetry(edgeAgentId, {
      type: "audit.local",
      deviceId: "simulator-1",
      capability: "toggle_led",
      success: false,
      error: "Argumentos inválidos: on must be boolean",
      at: new Date().toISOString(),
    });

    expect(auditStore.entries).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({
      actor: "user",
      action: "audit.local",
      subject: `${edgeAgentId}/simulator-1/toggle_led`,
      metadata: { success: false, error: "Argumentos inválidos: on must be boolean" },
    });
  });

  describe("userId en la auditoría (docs/19 P2, incremento 5)", () => {
    it("tool.execute lleva el requestingUserId de quien lo ejecutó", async () => {
      const { gateway, connectionManager, auditStore } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");
      const [tool] = gateway.listTools();

      const executePromise = gateway.executeTool(tool.name, {}, "user-1");
      const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: {},
        at: new Date().toISOString(),
      });
      await executePromise;

      expect(auditStore.entries[0]).toMatchObject({ action: "tool.execute", userId: "user-1" });
    });

    it("tool.execute.denied lleva el requestingUserId de quien intentó ejecutarlo (no el ownerId)", async () => {
      const { gateway, connectionManager, auditStore } = buildGateway();
      connectionManager.simulateAgentConnect(helloFor(randomUUID()), "user-1");
      const [tool] = gateway.listTools();

      await gateway.executeTool(tool.name, {}, "user-2");

      expect(auditStore.entries[0]).toMatchObject({ action: "tool.execute.denied", userId: "user-2" });
    });

    it("safety_policy.changed y audit.local llevan el ownerId del agente vinculado", () => {
      const { connectionManager, auditStore } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");

      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "safety_policy.changed",
        deviceId: "esp32-1",
        target: "5",
        severity: "irreversible-material",
        at: new Date().toISOString(),
      });
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "audit.local",
        deviceId: "simulator-1",
        capability: "toggle_led",
        success: true,
        at: new Date().toISOString(),
      });

      expect(auditStore.entries).toHaveLength(2);
      expect(auditStore.entries.every((entry) => entry.userId === "user-1")).toBe(true);
    });

    it("job.fired lleva el ownerId del agente que ese paso toca, sin darle owner al job en sí", async () => {
      const { gateway, connectionManager, scheduler, auditStore } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");
      const [tool] = gateway.listTools();

      const dispatchPromise = scheduler.dispatch!({ id: "job-userid", steps: [{ capabilityRef: tool.name, input: {} }] });
      const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: {},
        at: new Date().toISOString(),
      });
      await dispatchPromise;

      expect(auditStore.entries.find((entry) => entry.action === "job.fired")).toMatchObject({ userId: "user-1" });
    });

    it("job.notification nunca lleva userId — un job puede cubrir varios dispositivos con distinto owner", async () => {
      const { gateway, connectionManager, scheduler, auditStore } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");
      const [tool] = gateway.listTools();

      const dispatchPromise = scheduler.dispatch!({
        id: "job-notif",
        steps: [{ capabilityRef: tool.name, input: {} }],
        notification: { title: "Listo", body: "..." },
      });
      const taskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: {},
        at: new Date().toISOString(),
      });
      await dispatchPromise;

      const notification = auditStore.entries.find((entry) => entry.action === "job.notification");
      expect(notification?.userId).toBeUndefined();
    });
  });

  describe("resolveConfirmation() (ADR-059)", () => {
    it("manda pending_confirmation con el detalle completo (no solo el id) — lo que necesita un modal remoto para describir la acción", async () => {
      const { pendingResult } = await buildPendingConfirmation();

      expect(pendingResult.requiresConfirmation).toBe(true);
      expect(pendingResult.data).toMatchObject({ confirmationId: "conf-web-1", deviceId: "simulator-1", capabilityName: "read_sensor" });
    });

    it("aprobar reenvía agent_confirmation.resolve al Edge Agent dueño y resuelve con el resultado real", async () => {
      const { gateway, connectionManager, edgeAgentId } = await buildPendingConfirmation();

      const resolvePromise = gateway.resolveConfirmation("conf-web-1", true, "user-1");
      expect(connectionManager.dispatched).toEqual([{ type: "agent_confirmation.resolve", confirmationId: "conf-web-1", approved: true }]);

      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "confirmation_resolved",
        confirmationId: "conf-web-1",
        deviceId: "simulator-1",
        capabilityName: "read_sensor",
        success: true,
        data: { value: 1 },
        at: new Date().toISOString(),
      });

      await expect(resolvePromise).resolves.toEqual({ success: true, data: { value: 1 }, error: undefined });
    });

    it("rechaza si el requestingUserId no es el owner del Edge Agent, sin llegar a mandar nada", async () => {
      const { gateway, connectionManager } = await buildPendingConfirmation();

      const result = await gateway.resolveConfirmation("conf-web-1", true, "user-2");

      expect(result).toEqual({ success: false, error: "No autorizado: esta confirmación pertenece a otro usuario." });
      expect(connectionManager.dispatched).toHaveLength(0);
    });

    it("un confirmationId desconocido/ya resuelto devuelve undefined", async () => {
      const { gateway } = await buildPendingConfirmation();

      const result = await gateway.resolveConfirmation("no-existe", true, "user-1");

      expect(result).toBeUndefined();
    });
  });

  describe("listPendingConfirmations() — bandeja fuera del chat (requisito: verlas/aprobarlas sin conversación activa)", () => {
    it("sin ninguna confirmación pendiente, devuelve vacío", () => {
      const { gateway } = buildGateway();
      expect(gateway.listPendingConfirmations()).toEqual([]);
    });

    it("incluye una confirmación pendiente con su detalle completo, sin el edgeAgentId interno", async () => {
      const { gateway } = await buildPendingConfirmation();

      const pending = gateway.listPendingConfirmations();

      expect(pending).toEqual([
        { confirmationId: "conf-web-1", deviceId: "simulator-1", capabilityName: "read_sensor", input: {}, severity: "read-only" },
      ]);
    });

    it("una vez resuelta, ya no aparece en la lista", async () => {
      const { gateway, edgeAgentId, connectionManager } = await buildPendingConfirmation();

      const resolvePromise = gateway.resolveConfirmation("conf-web-1", true, "user-1");
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "confirmation_resolved",
        confirmationId: "conf-web-1",
        deviceId: "simulator-1",
        capabilityName: "read_sensor",
        success: true,
        at: new Date().toISOString(),
      });
      await resolvePromise;

      expect(gateway.listPendingConfirmations()).toEqual([]);
    });

    it("con requestingUserId, solo devuelve las de Edge Agents propios o sin vincular — nunca las de otro usuario", async () => {
      const { gateway } = await buildPendingConfirmation(); // Edge Agent con ownerId "user-1"

      expect(gateway.listPendingConfirmations("user-1")).toHaveLength(1);
      expect(gateway.listPendingConfirmations("user-2")).toEqual([]);
    });

    it("sin requestingUserId, no filtra (mismo criterio que GlobalCapabilityRegistry.list())", async () => {
      const { gateway } = await buildPendingConfirmation();
      expect(gateway.listPendingConfirmations()).toHaveLength(1);
    });
  });

  describe("tools de automatizaciones (ADR-039)", () => {
    it("listTools() las incluye siempre, incluso sin ningún Edge Agent conectado", () => {
      const { gateway } = buildGateway();

      const names = gateway.listTools().map((t) => t.name);

      expect(names).toEqual(expect.arrayContaining(["kan_schedule_job", "kan_cancel_job", "kan_list_jobs"]));
    });

    it("executeTool('kan_schedule_job', ...) llama scheduler.schedule() sin tocar el Edge Agent ni el chequeo de ownership", async () => {
      const { gateway, connectionManager, scheduler } = buildGateway();
      connectionManager.simulateAgentConnect(helloFor(randomUUID()), "user-1");
      const scheduleSpy = vi.spyOn(scheduler, "schedule");

      const result = await gateway.executeTool(
        "kan_schedule_job",
        { steps: [{ capabilityRef: "cualquier_ref" }], runAt: "2026-01-01T00:00:00.000Z" },
        "user-2", // otro usuario, distinto al owner del agente — no debería importar acá
      );

      expect(result.success).toBe(true);
      expect(scheduleSpy).toHaveBeenCalledOnce();
      expect(connectionManager.dispatched).toHaveLength(0);
    });

    it("executeTool('kan_schedule_job', ...) pasa requestingUserId como createdBy del job (P7)", async () => {
      const { gateway, scheduler } = buildGateway();
      const scheduleSpy = vi.spyOn(scheduler, "schedule");

      await gateway.executeTool(
        "kan_schedule_job",
        { steps: [{ capabilityRef: "cualquier_ref" }], runAt: "2026-01-01T00:00:00.000Z" },
        "user-3",
      );

      expect(scheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "user-3" }));
    });

    it("executeTool('kan_list_jobs', ...) llama scheduler.list()", async () => {
      const { gateway, scheduler } = buildGateway();
      const listSpy = vi.spyOn(scheduler, "list");

      const result = await gateway.executeTool("kan_list_jobs", {});

      expect(result).toEqual({ success: true, data: { jobs: [] } });
      expect(listSpy).toHaveBeenCalled();
    });
  });

  describe("tools de alertas (sistema básico de alertas)", () => {
    it("listTools() las incluye siempre, incluso sin ningún Edge Agent conectado", () => {
      const { gateway } = buildGateway();

      const names = gateway.listTools().map((t) => t.name);

      expect(names).toEqual(expect.arrayContaining(["kan_set_alert", "kan_cancel_alert", "kan_list_alerts"]));
    });

    it("executeTool('kan_set_alert', ...) crea la alerta sin tocar el Edge Agent", async () => {
      const { gateway, connectionManager } = buildGateway();

      const result = await gateway.executeTool("kan_set_alert", {
        capabilityRef: "cualquier_ref",
        field: "temperatureC",
        comparator: "above",
        threshold: 40,
        label: "la temperatura",
        unit: "grados",
      });

      expect(result.success).toBe(true);
      expect(gateway.alertMonitor.list()).toHaveLength(1);
      expect(connectionManager.dispatched).toHaveLength(0);
    });

    it("executeTool('kan_set_alert', ...) pasa requestingUserId como createdBy de la alerta", async () => {
      const { gateway } = buildGateway();

      await gateway.executeTool(
        "kan_set_alert",
        { capabilityRef: "c_x", comparator: "above", threshold: 40, label: "la temperatura" },
        "user-3",
      );

      expect(gateway.alertMonitor.list()[0].createdBy).toBe("user-3");
    });

    it("executeTool('kan_list_alerts', ...) devuelve las alertas activas", async () => {
      const { gateway } = buildGateway();
      await gateway.executeTool("kan_set_alert", {
        capabilityRef: "c_x",
        comparator: "above",
        threshold: 40,
        label: "la temperatura",
      });

      const result = await gateway.executeTool("kan_list_alerts", {});

      expect(result.success).toBe(true);
      expect((result.data as { alerts: unknown[] }).alerts).toHaveLength(1);
    });

    it("executeTool('kan_cancel_alert', ...) la saca de kan_list_alerts", async () => {
      const { gateway } = buildGateway();
      await gateway.executeTool("kan_set_alert", {
        capabilityRef: "c_x",
        comparator: "above",
        threshold: 40,
        label: "la temperatura",
      });
      const alertId = gateway.alertMonitor.list()[0].id;

      const result = await gateway.executeTool("kan_cancel_alert", { alertId });

      expect(result).toEqual({ success: true, data: { alertId } });
      expect(gateway.alertMonitor.list()).toHaveLength(0);
    });
  });

  // Timers reales con un poll interval corto (mismo criterio que el resto
  // del repo — ver JsonFileConfigStore.test.ts: "sin mockear timers, se
  // espera el debounce/intervalo real" — en vez de fake timers, que no
  // llevan bien mezclarse con una cadena async que depende de un evento
  // externo real (simulateTelemetry, disparado por el propio test).
  describe("dispatch de una alerta disparada (sistema básico de alertas)", () => {
    const ALERT_POLL_INTERVAL_MS = 20;

    it("cuando una alerta cruza su umbral, audita, notifica por push y — con sesión Live activa — avisa por voz", async () => {
      const speakToUser = vi.fn(() => true);
      const { gateway, connectionManager, auditStore, notificationService, bus } = buildGateway({
        speakToUser,
        alertPollIntervalMs: ALERT_POLL_INTERVAL_MS,
      });
      connectionManager.simulateAgentConnect(helloFor(randomUUID()));
      // El nombre real de la tool lo decide GlobalCapabilityRegistry — se
      // toma tal cual del catálogo en vez de adivinarlo, para no acoplar
      // este test a esa convención de nombres.
      const [readSensorTool] = gateway.listTools();

      const events: unknown[] = [];
      bus.on("alert.triggered", (payload) => events.push(payload));

      await gateway.executeTool(
        "kan_set_alert",
        { capabilityRef: readSensorTool.name, field: "temperatureC", comparator: "above", threshold: 40, label: "la temperatura", unit: "grados" },
        "user-1",
      );

      await vi.waitFor(() => expect(connectionManager.dispatched.length).toBeGreaterThan(0));
      const taskId = (connectionManager.dispatched.at(-1) as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: { temperatureC: 43 },
        at: new Date().toISOString(),
      });

      await vi.waitFor(() => expect(notificationService.sent.length).toBeGreaterThan(0));

      expect(events).toEqual([
        {
          alertId: gateway.alertMonitor.list()[0].id,
          capabilityRef: readSensorTool.name,
          value: 43,
          message: "La temperatura llegó a 43 grados, superó el límite que definiste de 40.",
        },
      ]);

      expect(notificationService.sent).toEqual([
        {
          userId: "user-1",
          channel: "push",
          title: "Alerta de KAN",
          body: "La temperatura llegó a 43 grados, superó el límite que definiste de 40.",
          severity: "warning",
        },
      ]);

      expect(speakToUser).toHaveBeenCalledWith("user-1", "La temperatura llegó a 43 grados, superó el límite que definiste de 40.");

      expect(auditStore.entries.find((entry) => entry.action === "alert.triggered")).toMatchObject({
        actor: "system",
        subject: "Alerta de KAN",
        userId: "user-1",
        metadata: {
          value: 43,
          threshold: 40,
          body: "La temperatura llegó a 43 grados, superó el límite que definiste de 40.",
        },
      });

      gateway.shutdown();
    });

    it("multi-usuario (edge_agent_grants): notifica al dueño + todos los invitados del Edge Agent, no solo a quien creó la alerta", async () => {
      const { gateway, connectionManager, notificationService } = buildGateway({
        alertPollIntervalMs: ALERT_POLL_INTERVAL_MS,
      });
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");
      gateway.agentRegistry.setGrantedUserIds(edgeAgentId, ["user-2", "user-3"]);
      const [readSensorTool] = gateway.listTools();

      await gateway.executeTool(
        "kan_set_alert",
        { capabilityRef: readSensorTool.name, field: "temperatureC", comparator: "above", threshold: 40, label: "la temperatura", unit: "grados" },
        "user-1",
      );

      await vi.waitFor(() => expect(connectionManager.dispatched.length).toBeGreaterThan(0));
      const taskId = (connectionManager.dispatched.at(-1) as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: { temperatureC: 43 },
        at: new Date().toISOString(),
      });

      await vi.waitFor(() => expect(notificationService.sent).toHaveLength(3));

      const message = "La temperatura llegó a 43 grados, superó el límite que definiste de 40.";
      expect(notificationService.sent).toEqual([
        { userId: "user-1", channel: "push", title: "Alerta de KAN", body: message, severity: "warning" },
        { userId: "user-2", channel: "push", title: "Alerta de KAN", body: message, severity: "warning" },
        { userId: "user-3", channel: "push", title: "Alerta de KAN", body: message, severity: "warning" },
      ]);

      gateway.shutdown();
    });

    it("sin invitados (Edge Agent sin edge_agent_grants), notifica solo al dueño — mismo comportamiento que antes de multi-usuario", async () => {
      const { gateway, connectionManager, notificationService } = buildGateway({
        alertPollIntervalMs: ALERT_POLL_INTERVAL_MS,
      });
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloFor(edgeAgentId), "user-1");
      const [readSensorTool] = gateway.listTools();

      await gateway.executeTool(
        "kan_set_alert",
        { capabilityRef: readSensorTool.name, field: "temperatureC", comparator: "above", threshold: 40, label: "la temperatura", unit: "grados" },
        "user-1",
      );

      await vi.waitFor(() => expect(connectionManager.dispatched.length).toBeGreaterThan(0));
      const taskId = (connectionManager.dispatched.at(-1) as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: { temperatureC: 43 },
        at: new Date().toISOString(),
      });

      await vi.waitFor(() => expect(notificationService.sent).toHaveLength(1));
      expect(notificationService.sent[0].userId).toBe("user-1");

      gateway.shutdown();
    });

    it("sin sesión Live activa (speakToUser ausente), sigue avisando por push sin fallar", async () => {
      const { gateway, connectionManager, notificationService } = buildGateway({
        alertPollIntervalMs: ALERT_POLL_INTERVAL_MS,
      });
      connectionManager.simulateAgentConnect(helloFor(randomUUID()));
      const [readSensorTool] = gateway.listTools();

      await gateway.executeTool(
        "kan_set_alert",
        { capabilityRef: readSensorTool.name, field: "temperatureC", comparator: "above", threshold: 40, label: "la temperatura", unit: "grados" },
        "user-1",
      );

      await vi.waitFor(() => expect(connectionManager.dispatched.length).toBeGreaterThan(0));
      const taskId = (connectionManager.dispatched.at(-1) as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(gateway.agentRegistry.list()[0].edgeAgentId, {
        type: "telemetry",
        taskId,
        status: "done",
        data: { temperatureC: 41 },
        at: new Date().toISOString(),
      });

      await vi.waitFor(() => expect(notificationService.sent).toHaveLength(1));

      gateway.shutdown();
    });

    it("shutdown() detiene el sondeo de alertas — ningún poll más corre después", async () => {
      const { gateway, connectionManager, notificationService } = buildGateway({
        alertPollIntervalMs: ALERT_POLL_INTERVAL_MS,
      });
      connectionManager.simulateAgentConnect(helloFor(randomUUID()));
      const [readSensorTool] = gateway.listTools();
      await gateway.executeTool("kan_set_alert", {
        capabilityRef: readSensorTool.name,
        field: "temperatureC",
        comparator: "above",
        threshold: 40,
        label: "la temperatura",
      });

      gateway.shutdown();
      await new Promise((resolve) => setTimeout(resolve, ALERT_POLL_INTERVAL_MS * 5));

      expect(notificationService.sent).toHaveLength(0);
    });
  });

  describe("kan_run_sequence — multi-dispositivo coordinado ad-hoc", () => {
    it("listTools() la incluye siempre, incluso sin ningún Edge Agent conectado", () => {
      const { gateway } = buildGateway();
      expect(gateway.listTools().map((t) => t.name)).toContain("kan_run_sequence");
    });

    it("rechaza sin 'steps'", async () => {
      const { gateway } = buildGateway();
      const result = await gateway.executeTool("kan_run_sequence", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("steps");
    });

    it("corre los pasos en orden y reporta cada uno con deviceName + description (lenguaje simple, nunca el ref técnico)", async () => {
      const { gateway, connectionManager } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloForSensorMotorAndLed(edgeAgentId));
      const tools = gateway.listTools();
      const motorTool = findToolByDevice(tools, "motor-1");
      const ledTool = findToolByDevice(tools, "led-1");

      const executePromise = gateway.executeTool("kan_run_sequence", {
        steps: [
          { capabilityRef: motorTool.name, input: { on: false } },
          { capabilityRef: ledTool.name, input: { on: true } },
        ],
      });

      expect(connectionManager.dispatched).toHaveLength(1);
      const firstTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: firstTaskId, status: "done", data: { ok: true }, at: new Date().toISOString() });

      await vi.waitFor(() => expect(connectionManager.dispatched).toHaveLength(2));
      const secondTaskId = (connectionManager.dispatched[1] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: secondTaskId, status: "done", data: { ok: true }, at: new Date().toISOString() });

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        steps: [
          { deviceName: "Motor del taller", description: "Prende o apaga el motor", outcome: "done", data: { ok: true } },
          { deviceName: "LED de alerta", description: "Prende o apaga el LED", outcome: "done", data: { ok: true } },
        ],
      });
    });

    it("se detiene en el primer paso que falla — el siguiente nunca se dispatchea", async () => {
      const { gateway, connectionManager } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloForSensorMotorAndLed(edgeAgentId));
      const tools = gateway.listTools();
      const motorTool = findToolByDevice(tools, "motor-1");
      const ledTool = findToolByDevice(tools, "led-1");

      const executePromise = gateway.executeTool("kan_run_sequence", {
        steps: [{ capabilityRef: motorTool.name }, { capabilityRef: ledTool.name }],
      });

      const firstTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: firstTaskId, status: "failed", error: "el motor no responde", at: new Date().toISOString() });

      const result = await executePromise;
      expect(result).toEqual({
        success: false,
        error: "el motor no responde",
        data: { steps: [{ deviceName: "Motor del taller", description: "Prende o apaga el motor", outcome: "failed", error: "el motor no responde" }] },
      });
      expect(connectionManager.dispatched).toHaveLength(1); // el LED nunca se llegó a dispatchear
    });

    it("se detiene en el primer paso que necesita confirmación — no la saltea, y el resultado trae el confirmationId como cualquier tool call individual", async () => {
      const { gateway, connectionManager } = buildGateway();
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloForSensorMotorAndLed(edgeAgentId));
      const tools = gateway.listTools();
      const motorTool = findToolByDevice(tools, "motor-1");
      const ledTool = findToolByDevice(tools, "led-1");

      const executePromise = gateway.executeTool("kan_run_sequence", {
        steps: [{ capabilityRef: motorTool.name }, { capabilityRef: ledTool.name }],
      });

      const firstTaskId = (connectionManager.dispatched[0] as { taskId: string }).taskId;
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId: firstTaskId,
        status: "pending_confirmation",
        confirmationId: "conf-seq-1",
        at: new Date().toISOString(),
      });

      const result = await executePromise;
      expect(result.requiresConfirmation).toBe(true);
      expect(result.data).toMatchObject({
        confirmationId: "conf-seq-1",
        deviceId: "motor-1",
        capabilityName: "toggle_motor",
        steps: [{ deviceName: "Motor del taller", description: "Prende o apaga el motor", outcome: "pending_confirmation" }],
      });
      expect(connectionManager.dispatched).toHaveLength(1); // el LED nunca se llegó a dispatchear

      // El confirmationId es el mismo que usa cualquier acción individual —
      // resolveConfirmation() ya funciona sobre él sin cambios.
      const resolvePromise = gateway.resolveConfirmation("conf-seq-1", true, undefined);
      expect(connectionManager.dispatched).toEqual([
        expect.objectContaining({ type: "agent_task.dispatch" }),
        { type: "agent_confirmation.resolve", confirmationId: "conf-seq-1", approved: true },
      ]);
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "confirmation_resolved",
        confirmationId: "conf-seq-1",
        deviceId: "motor-1",
        capabilityName: "toggle_motor",
        success: true,
        at: new Date().toISOString(),
      });
      await expect(resolvePromise).resolves.toEqual({ success: true, data: undefined, error: undefined });
    });
  });

  describe("kan_set_alert con 'steps' — multi-dispositivo coordinado disparado por una alerta", () => {
    // Mismo intervalo corto que el resto de los tests de alertas — el poll
    // sigue disparando cada tick aunque ya esté auditada (AlertMonitor.
    // pollRule() llama al reader en CADA tick, ver su comentario), así que
    // `dispatched` puede traer más de un poll del sensor de sobra —
    // `dispatchFor` busca por `deviceId` y se queda con el último, robusto
    // ante eso en vez de asumir un índice fijo.
    const ALERT_POLL_INTERVAL_MS = 20;

    /** Encuentra (y espera si hace falta) el dispatch más nuevo para un deviceId — robusto ante pollos de la alerta interleaved. */
    async function dispatchFor(connectionManager: FakeConnectionManager, deviceId: string) {
      await vi.waitFor(() => expect(connectionManager.dispatched.some((m) => (m as { deviceId?: string }).deviceId === deviceId)).toBe(true));
      const matches = connectionManager.dispatched.filter((m) => (m as { deviceId?: string }).deviceId === deviceId);
      return matches[matches.length - 1] as { taskId: string };
    }

    it("al disparar, corre la secuencia y suma el resultado al mensaje del aviso", async () => {
      const { gateway, connectionManager, notificationService } = buildGateway({ alertPollIntervalMs: ALERT_POLL_INTERVAL_MS });
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloForSensorMotorAndLed(edgeAgentId));
      const tools = gateway.listTools();
      const sensorTool = findToolByDevice(tools, "simulator-1");
      const motorTool = findToolByDevice(tools, "motor-1");
      const ledTool = findToolByDevice(tools, "led-1");

      await gateway.executeTool("kan_set_alert", {
        capabilityRef: sensorTool.name,
        field: "temperatureC",
        comparator: "above",
        threshold: 35,
        label: "la temperatura",
        unit: "grados",
        steps: [{ capabilityRef: motorTool.name, input: { on: false } }, { capabilityRef: ledTool.name, input: { on: true } }],
      });

      // Poll de la alerta -> el sensor supera el umbral.
      const sensorTask = await dispatchFor(connectionManager, "simulator-1");
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: sensorTask.taskId, status: "done", data: { temperatureC: 40 }, at: new Date().toISOString() });

      // Secuencia disparada: motor, luego LED.
      const motorTask = await dispatchFor(connectionManager, "motor-1");
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: motorTask.taskId, status: "done", data: {}, at: new Date().toISOString() });
      const ledTask = await dispatchFor(connectionManager, "led-1");
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: ledTask.taskId, status: "done", data: {}, at: new Date().toISOString() });

      await vi.waitFor(() => expect(notificationService.sent).toHaveLength(1));
      expect(notificationService.sent[0].body).toBe(
        "La temperatura llegó a 40 grados, superó el límite que definiste de 35. Se ejecutó la secuencia asociada.",
      );

      gateway.shutdown();
    });

    it("si un paso de la secuencia necesita confirmación, el aviso lo dice y la auditoría guarda el confirmationId", async () => {
      const { gateway, connectionManager, auditStore } = buildGateway({ alertPollIntervalMs: ALERT_POLL_INTERVAL_MS });
      const edgeAgentId = randomUUID();
      connectionManager.simulateAgentConnect(helloForSensorMotorAndLed(edgeAgentId));
      const tools = gateway.listTools();
      const sensorTool = findToolByDevice(tools, "simulator-1");
      const motorTool = findToolByDevice(tools, "motor-1");

      await gateway.executeTool("kan_set_alert", {
        capabilityRef: sensorTool.name,
        field: "temperatureC",
        comparator: "above",
        threshold: 35,
        label: "la temperatura",
        unit: "grados",
        steps: [{ capabilityRef: motorTool.name }],
      });

      const sensorTask = await dispatchFor(connectionManager, "simulator-1");
      connectionManager.simulateTelemetry(edgeAgentId, { type: "telemetry", taskId: sensorTask.taskId, status: "done", data: { temperatureC: 40 }, at: new Date().toISOString() });

      const motorTask = await dispatchFor(connectionManager, "motor-1");
      connectionManager.simulateTelemetry(edgeAgentId, {
        type: "telemetry",
        taskId: motorTask.taskId,
        status: "pending_confirmation",
        confirmationId: "conf-alert-seq-1",
        at: new Date().toISOString(),
      });

      await vi.waitFor(() =>
        expect(auditStore.entries.find((e) => e.action === "alert.triggered")?.metadata.sequenceConfirmationId).toBe("conf-alert-seq-1"),
      );
      const entry = auditStore.entries.find((e) => e.action === "alert.triggered");
      expect(entry?.metadata.body).toBe(
        "La temperatura llegó a 40 grados, superó el límite que definiste de 35. KAN necesita tu confirmación para terminar la secuencia asociada.",
      );

      gateway.shutdown();
    });
  });
});
