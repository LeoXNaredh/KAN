import { describe, expect, it } from "vitest";
import type { CapabilityDescriptor, CoreToEdgeMessage } from "@kan/plugin-contract";
import { GatewayBus } from "./GatewayBus";
import { AgentRegistry } from "./AgentRegistry";
import { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";
import { TaskOrchestrator } from "./TaskOrchestrator";
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
  const auditStore = new InMemoryAuditStore();
  const auditService = new AuditService(auditStore, bus);
  const executor = new OrchestratorToolExecutor(orchestrator, auditService, bus);

  agentRegistry.upsert({
    edgeAgentId: "agent-1",
    status: "offline",
    protocolVersion: "1.0.0",
    installedPlugins: [],
    devices: [],
    lastSeenAt: new Date().toISOString(),
  });
  agentRegistry.markOnline("agent-1");
  capabilityRegistry.sync("agent-1", [{ deviceId: "simulator-1", capability: CAP }]);
  const ref = capabilityRegistry.list()[0].ref;

  return { orchestrator, connectionManager, auditStore, executor, ref };
}

describe("OrchestratorToolExecutor", () => {
  it("registra auditoría ANTES de ejecutar (propuesta del LLM) y emite tool.proposed", async () => {
    const { executor, auditStore, connectionManager, orchestrator, ref } = setup();

    const executePromise = executor.execute({ ref, args: {} });
    // El registro de auditoría ocurre de forma síncrona antes de que se resuelva la tarea.
    expect(auditStore.entries).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({ actor: "llm", action: "tool.execute", subject: ref });

    const taskId = (connectionManager.sent[0].message as { taskId: string }).taskId;
    orchestrator.handleTelemetry({ type: "telemetry", taskId, status: "done", data: { ok: true }, at: new Date().toISOString() });

    await expect(executePromise).resolves.toEqual({ success: true, data: { ok: true }, error: undefined });
  });

  it("mapea pending_confirmation a un ToolExecutionResult claro para el LLM (no ejecuta sola una acción peligrosa)", async () => {
    const { executor, connectionManager, orchestrator, ref } = setup();

    const executePromise = executor.execute({ ref, args: {} });
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
    expect(result.data).toEqual({ confirmationId: "conf-1" });
  });

  it("propaga el error cuando la capability no existe", async () => {
    const { executor } = setup();
    const result = await executor.execute({ ref: "ref-inexistente", args: {} });
    expect(result).toEqual({ success: false, data: undefined, error: "Capability desconocida: ref-inexistente" });
  });
});
