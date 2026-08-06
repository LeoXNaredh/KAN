import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CoreToEdgeMessage, EdgeToCoreMessage, HelloMessage } from "@kan/plugin-contract";
import { GatewayBus } from "./application/GatewayBus";
import { Gateway } from "./Gateway";
import type { AgentConnectionInfo, ConnectionManagerPort, Unsubscribe } from "./domain/ports/ConnectionManagerPort";
import type { AuditStorePort } from "./domain/ports/AuditStorePort";
import type { SchedulerPort } from "./domain/ports/SchedulerPort";
import type { NotificationServicePort } from "./domain/ports/NotificationServicePort";
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
  simulateAgentConnect(hello: HelloMessage): void {
    const info: AgentConnectionInfo = {
      edgeAgentId: hello.edgeAgentId,
      protocolVersion: hello.protocolVersion,
      connectedAt: new Date().toISOString(),
      hello,
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
  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }
  list(): AuditEntry[] {
    return this.entries;
  }
}

class NoopSchedulerStub implements SchedulerPort {
  schedule(): string {
    return "unused";
  }
  cancel(): void {}
  list() {
    return [];
  }
}

class NoopNotificationStub implements NotificationServicePort {
  async notify(): Promise<void> {}
}

function buildGateway() {
  const bus = new GatewayBus();
  const connectionManager = new FakeConnectionManager();
  const auditStore = new InMemoryAuditStore();
  const gateway = new Gateway({
    bus,
    connectionManager,
    auditStore,
    scheduler: new NoopSchedulerStub(),
    notificationService: new NoopNotificationStub(),
  });
  gateway.bootstrap();
  return { gateway, connectionManager, auditStore, bus };
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
});
