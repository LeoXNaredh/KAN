import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CoreToEdgeMessage, EdgeToCoreMessage, HelloMessage } from "@kan/plugin-contract";
import { GatewayBus } from "./application/GatewayBus";
import { Gateway } from "./Gateway";
import type { AgentConnectionInfo, ConnectionManagerPort, Unsubscribe } from "./domain/ports/ConnectionManagerPort";
import type { AuditStorePort } from "./domain/ports/AuditStorePort";
import type { SchedulerDispatch, SchedulerPort } from "./domain/ports/SchedulerPort";
import type { NotificationServicePort } from "./domain/ports/NotificationServicePort";
import type { Notification } from "./domain/entities/Notification";
import type { AuditEntry } from "./domain/entities/AuditEntry";

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

function buildGateway() {
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
      { id: "kan-plugin-device-simulator", version: "0.1.0", displayName: "Simulador", kind: "device-driver", runtime: "in-process-ts" },
    ],
    capabilities: [
      {
        deviceId: "simulator-1",
        deviceName: "Dispositivo Simulado #1",
        capability: { name: "read_sensor", description: "...", severity: "read-only", supportsDryRun: false },
      },
    ],
  };
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
    expect(tools).toHaveLength(1);
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

    // Toda ejecución de tool queda auditada (docs/12 §6).
    expect(auditStore.entries).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({ actor: "llm", action: "tool.execute" });
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
    expect(gateway.listTools()).toHaveLength(1);

    gateway.agentRegistry.markOffline(edgeAgentId);
    gateway.capabilityRegistry.removeAgent(edgeAgentId);

    expect(gateway.listTools()).toHaveLength(0);
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
    expect(auditStore.entries).toHaveLength(1);
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
});
