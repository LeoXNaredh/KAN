import { describe, expect, it } from "vitest";
import type { CapabilityDescriptor, CoreToEdgeMessage } from "@kan/plugin-contract";
import { GatewayBus } from "./GatewayBus";
import { AgentRegistry } from "./AgentRegistry";
import { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";
import { TaskOrchestrator } from "./TaskOrchestrator";
import { ConfirmationOrchestrator } from "./ConfirmationOrchestrator";
import type { AuditEntry } from "../domain/entities/AuditEntry";
import { AuditService } from "./AuditService";
import { OrchestratorToolExecutor } from "./ToolExecutor";
import type { AuditStorePort } from "../domain/ports/AuditStorePort";
import type { ConnectionManagerPort, Unsubscribe } from "../domain/ports/ConnectionManagerPort";

const CAP: CapabilityDescriptor = {
  name: "read_sensor",
  description: "...",
  severity: "read-only",
  supportsDryRun: false,
};

const DANGEROUS_CAP: CapabilityDescriptor = {
  name: "move_arm",
  description: "...",
  severity: "irreversible-material",
  supportsDryRun: false,
};

class FakeConnectionManager implements ConnectionManagerPort {
  sent: Array<{ edgeAgentId: string; message: CoreToEdgeMessage }> = [];
  start(): void {}
  stop(): void {}
  send(edgeAgentId: string, message: CoreToEdgeMessage): boolean {
    this.sent.push({ edgeAgentId, message });
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

class InMemoryAuditStore implements AuditStorePort {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<AuditEntry[]> {
    return this.entries;
  }
}

function setup() {
  const bus = new GatewayBus();
  const agentRegistry = new AgentRegistry(bus);
  const capabilityRegistry = new GlobalCapabilityRegistry(bus);
  const connectionManager = new FakeConnectionManager();
  const orchestrator = new TaskOrchestrator(agentRegistry, capabilityRegistry, connectionManager, bus);
  const confirmationOrchestrator = new ConfirmationOrchestrator(connectionManager, agentRegistry);
  const auditStore = new InMemoryAuditStore();
  const auditService = new AuditService(auditStore, bus);
  const executor = new OrchestratorToolExecutor(orchestrator, confirmationOrchestrator, auditService, bus);

  agentRegistry.upsert({
    edgeAgentId: "agent-1",
    status: "offline",
    protocolVersion: "1.0.0",
    installedPlugins: [],
    devices: [],
    lastSeenAt: new Date().toISOString(),
  });
  agentRegistry.markOnline("agent-1");
  capabilityRegistry.sync("agent-1", [
    { deviceId: "simulator-1", capability: CAP },
    { deviceId: "arm-1", capability: DANGEROUS_CAP },
  ]);
  const capability = capabilityRegistry.list().find((c) => c.capability.name === "read_sensor")!;
  const dangerousCapability = capabilityRegistry.list().find((c) => c.capability.name === "move_arm")!;

  return { orchestrator, confirmationOrchestrator, connectionManager, auditStore, executor, capability, dangerousCapability };
}

describe("OrchestratorToolExecutor", () => {
  it("registra auditoría ANTES de ejecutar (propuesta del LLM) y emite tool.proposed", async () => {
    const { executor, auditStore, connectionManager, orchestrator, capability } = setup();

    const executePromise = executor.execute({ ref: capability.ref, args: {} }, capability);
    // El registro de auditoría ocurre de forma síncrona antes de que se resuelva la tarea.
    expect(auditStore.entries).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({ actor: "llm", action: "tool.execute", subject: capability.ref });

    const taskId = (connectionManager.sent[0].message as { taskId: string }).taskId;
    orchestrator.handleTelemetry({ type: "telemetry", taskId, status: "done", data: { ok: true }, at: new Date().toISOString() });

    await expect(executePromise).resolves.toEqual({ success: true, data: { ok: true }, error: undefined });

    // Segunda entrada aditiva, con el resultado real (DailyReportService la usa para "acciones exitosas/fallidas").
    expect(auditStore.entries).toHaveLength(2);
    expect(auditStore.entries[1]).toMatchObject({
      actor: "system",
      action: "tool.execute.result",
      subject: capability.ref,
      metadata: { success: true, error: undefined },
    });
  });

  it("registra tool.execute.result con success:false cuando la ejecución falla", async () => {
    const { executor, auditStore, connectionManager, orchestrator, capability } = setup();

    const executePromise = executor.execute({ ref: capability.ref, args: {} }, capability, "user-1");
    const taskId = (connectionManager.sent[0].message as { taskId: string }).taskId;
    orchestrator.handleTelemetry({ type: "telemetry", taskId, status: "failed", error: "el sensor no responde", at: new Date().toISOString() });

    await executePromise;

    expect(auditStore.entries[1]).toMatchObject({
      actor: "system",
      action: "tool.execute.result",
      subject: capability.ref,
      userId: "user-1",
      metadata: { success: false, error: "el sensor no responde" },
    });
  });

  it("mapea pending_confirmation a un ToolExecutionResult claro para el LLM (no ejecuta sola una acción peligrosa)", async () => {
    const { executor, auditStore, connectionManager, orchestrator, dangerousCapability } = setup();

    const executePromise = executor.execute({ ref: dangerousCapability.ref, args: { angle: 30 } }, dangerousCapability);
    const taskId = (connectionManager.sent[0].message as { taskId: string }).taskId;
    orchestrator.handleTelemetry({
      type: "telemetry",
      taskId,
      status: "pending_confirmation",
      confirmationId: "conf-1",
      at: new Date().toISOString(),
    });

    const result = await executePromise;
    expect(result.success).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.data).toEqual({
      confirmationId: "conf-1",
      deviceId: "arm-1",
      capabilityName: "move_arm",
      input: { angle: 30 },
      severity: "irreversible-material",
    });
    // pending_confirmation no genera la segunda entrada aditiva — su resultado final no se audita hoy (ver comentario en ToolExecutor.execute()).
    expect(auditStore.entries).toHaveLength(1);
  });

  it("registra la confirmación pendiente en ConfirmationOrchestrator, resoluble después sin un segundo round-trip", async () => {
    const { executor, connectionManager, orchestrator, confirmationOrchestrator, dangerousCapability } = setup();

    const executePromise = executor.execute({ ref: dangerousCapability.ref, args: { angle: 30 } }, dangerousCapability);
    const taskId = (connectionManager.sent[0].message as { taskId: string }).taskId;
    orchestrator.handleTelemetry({
      type: "telemetry",
      taskId,
      status: "pending_confirmation",
      confirmationId: "conf-2",
      at: new Date().toISOString(),
    });
    await executePromise;
    connectionManager.sent.length = 0;

    const resolvePromise = confirmationOrchestrator.resolve("conf-2", true);
    expect(connectionManager.sent).toEqual([
      { edgeAgentId: "agent-1", message: { type: "agent_confirmation.resolve", confirmationId: "conf-2", approved: true } },
    ]);
    confirmationOrchestrator.handleResolved({
      type: "confirmation_resolved",
      confirmationId: "conf-2",
      deviceId: "arm-1",
      capabilityName: "move_arm",
      success: true,
      data: { moved: true },
      at: new Date().toISOString(),
    });
    await expect(resolvePromise).resolves.toEqual({ success: true, data: { moved: true }, error: undefined });
  });
});
