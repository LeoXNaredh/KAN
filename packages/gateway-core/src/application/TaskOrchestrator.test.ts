import { describe, expect, it, vi, afterEach } from "vitest";
import type { CapabilityDescriptor, CoreToEdgeMessage, TelemetryMessage } from "@kan/plugin-contract";
import { GatewayBus } from "./GatewayBus";
import { AgentRegistry } from "./AgentRegistry";
import { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";
import { TaskOrchestrator } from "./TaskOrchestrator";
import type { ConnectionManagerPort, Unsubscribe } from "../domain/ports/ConnectionManagerPort";

const CAP: CapabilityDescriptor = {
  name: "read_sensor",
  description: "...",
  severity: "read-only",
  supportsDryRun: false,
};

class FakeConnectionManager implements ConnectionManagerPort {
  sentMessages: Array<{ edgeAgentId: string; message: CoreToEdgeMessage }> = [];
  shouldFailSend = false;

  start(): void {}
  stop(): void {}

  send(edgeAgentId: string, message: CoreToEdgeMessage): boolean {
    if (this.shouldFailSend) return false;
    this.sentMessages.push({ edgeAgentId, message });
    return true;
  }

  onAgentConnected(): Unsubscribe {
    return () => {};
  }
  onAgentDisconnected(): Unsubscribe {
    return () => {};
  }
  onMessage(): Unsubscribe {
    return () => {};
  }
  getState(): "connected" | "disconnected" {
    return "connected";
  }
}

function setup() {
  const bus = new GatewayBus();
  const agentRegistry = new AgentRegistry(bus);
  const capabilityRegistry = new GlobalCapabilityRegistry(bus);
  const connectionManager = new FakeConnectionManager();
  const orchestrator = new TaskOrchestrator(agentRegistry, capabilityRegistry, connectionManager, bus);
  return { bus, agentRegistry, capabilityRegistry, connectionManager, orchestrator };
}

function registerOnlineAgent(agentRegistry: AgentRegistry, capabilityRegistry: GlobalCapabilityRegistry, edgeAgentId: string) {
  agentRegistry.upsert({
    edgeAgentId,
    status: "offline",
    protocolVersion: "1.0.0",
    installedPlugins: [],
    devices: [],
    lastSeenAt: new Date().toISOString(),
  });
  agentRegistry.markOnline(edgeAgentId);
  capabilityRegistry.sync(edgeAgentId, [{ deviceId: "simulator-1", capability: CAP }]);
  return capabilityRegistry.list()[0].ref;
}

describe("TaskOrchestrator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("falla rápido si la capability no existe", async () => {
    const { orchestrator } = setup();
    const result = await orchestrator.submit({ capabilityRef: "no-existe", input: {} });
    expect(result).toEqual({ status: "failed", error: "Capability desconocida: no-existe" });
  });

  it("falla rápido si el Edge Agent dueño de la capability no está online", async () => {
    const { orchestrator, agentRegistry, capabilityRegistry } = setup();
    const ref = registerOnlineAgent(agentRegistry, capabilityRegistry, "agent-1");
    agentRegistry.markOffline("agent-1");

    const result = await orchestrator.submit({ capabilityRef: ref, input: {} });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/no está conectado/);
  });

  it("despacha el mensaje correcto y resuelve cuando llega la telemetría 'done'", async () => {
    const { orchestrator, agentRegistry, capabilityRegistry, connectionManager } = setup();
    const ref = registerOnlineAgent(agentRegistry, capabilityRegistry, "agent-1");

    const resultPromise = orchestrator.submit({ capabilityRef: ref, input: { foo: "bar" } });

    expect(connectionManager.sentMessages).toHaveLength(1);
    const sent = connectionManager.sentMessages[0];
    expect(sent.edgeAgentId).toBe("agent-1");
    expect(sent.message).toMatchObject({
      type: "agent_task.dispatch",
      deviceId: "simulator-1",
      capability: "read_sensor",
      payload: { foo: "bar" },
    });

    const telemetry: TelemetryMessage = {
      type: "telemetry",
      taskId: (sent.message as { taskId: string }).taskId,
      status: "done",
      data: { temperatureC: 21 },
      at: new Date().toISOString(),
    };
    orchestrator.handleTelemetry(telemetry);

    await expect(resultPromise).resolves.toEqual({ status: "done", data: { temperatureC: 21 }, error: undefined, confirmationId: undefined });
  });

  it("resuelve con pending_confirmation sin esperar más cuando el Edge Agent lo reporta", async () => {
    const { orchestrator, agentRegistry, capabilityRegistry, connectionManager } = setup();
    const ref = registerOnlineAgent(agentRegistry, capabilityRegistry, "agent-1");

    const resultPromise = orchestrator.submit({ capabilityRef: ref, input: {} });
    const sent = connectionManager.sentMessages[0].message as { taskId: string };

    orchestrator.handleTelemetry({
      type: "telemetry",
      taskId: sent.taskId,
      status: "pending_confirmation",
      confirmationId: "conf-123",
      at: new Date().toISOString(),
    });

    await expect(resultPromise).resolves.toEqual({
      status: "pending_confirmation",
      data: undefined,
      error: undefined,
      confirmationId: "conf-123",
    });
  });

  it("hace timeout si no llega telemetría", async () => {
    vi.useFakeTimers();
    const { orchestrator, agentRegistry, capabilityRegistry } = setup();
    const ref = registerOnlineAgent(agentRegistry, capabilityRegistry, "agent-1");

    const resultPromise = orchestrator.submit({ capabilityRef: ref, input: {} });
    vi.advanceTimersByTime(40_001);

    await expect(resultPromise).resolves.toEqual({
      status: "failed",
      error: "Timeout esperando respuesta del Edge Agent",
    });
  });

  it("telemetría de progreso no resuelve la tarea", async () => {
    vi.useFakeTimers();
    const { orchestrator, agentRegistry, capabilityRegistry, connectionManager } = setup();
    const ref = registerOnlineAgent(agentRegistry, capabilityRegistry, "agent-1");

    const resultPromise = orchestrator.submit({ capabilityRef: ref, input: {} });
    const sent = connectionManager.sentMessages[0].message as { taskId: string };

    orchestrator.handleTelemetry({ type: "telemetry", taskId: sent.taskId, status: "progress", at: new Date().toISOString() });

    // Todavía no resuelta: avanzar menos que el timeout no debe resolverla.
    vi.advanceTimersByTime(5_000);
    let settled = false;
    resultPromise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    // Ahora sí llega el resultado final.
    orchestrator.handleTelemetry({ type: "telemetry", taskId: sent.taskId, status: "done", at: new Date().toISOString() });
    await expect(resultPromise).resolves.toMatchObject({ status: "done" });
  });

  it("getTask() refleja el estado final tras resolverse", async () => {
    const { orchestrator, agentRegistry, capabilityRegistry, connectionManager } = setup();
    const ref = registerOnlineAgent(agentRegistry, capabilityRegistry, "agent-1");

    const resultPromise = orchestrator.submit({ capabilityRef: ref, input: {} });
    const sent = connectionManager.sentMessages[0].message as { taskId: string };
    orchestrator.handleTelemetry({ type: "telemetry", taskId: sent.taskId, status: "done", at: new Date().toISOString() });
    await resultPromise;

    expect(orchestrator.getTask(sent.taskId)?.status).toBe("done");
  });
});
