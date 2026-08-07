import type { AgentRecord } from "./domain/entities/AgentRecord";
import type { ConnectionManagerPort } from "./domain/ports/ConnectionManagerPort";
import type { AuditStorePort } from "./domain/ports/AuditStorePort";
import type { SchedulerPort } from "./domain/ports/SchedulerPort";
import type { NotificationServicePort } from "./domain/ports/NotificationServicePort";
import type { GatewayBus } from "./application/GatewayBus";
import { AgentRegistry } from "./application/AgentRegistry";
import { GlobalCapabilityRegistry } from "./application/GlobalCapabilityRegistry";
import { TaskOrchestrator } from "./application/TaskOrchestrator";
import { AuditService } from "./application/AuditService";
import { CapabilityBackedToolRegistry, type ToolRegistry } from "./application/ToolRegistry";
import { RegistryToolResolver } from "./application/ToolResolver";
import { OrchestratorToolExecutor } from "./application/ToolExecutor";
import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";

export interface GatewayDeps {
  bus: GatewayBus;
  connectionManager: ConnectionManagerPort;
  auditStore: AuditStorePort;
  scheduler: SchedulerPort;
  notificationService: NotificationServicePort;
}

/**
 * Composition root del Gateway (docs/12): une Connection Manager, Agent
 * Registry, Capability Registry, Task Orchestrator, Function Calling Engine,
 * Audit Service y Scheduler, y hace el ruteo entre el transporte y esos
 * módulos. Notification Service queda disponible pero sin ningún flujo real
 * que lo dispare todavía (seam, docs/12 §9).
 */
export class Gateway {
  readonly bus: GatewayBus;
  readonly agentRegistry: AgentRegistry;
  readonly capabilityRegistry: GlobalCapabilityRegistry;
  readonly taskOrchestrator: TaskOrchestrator;
  readonly auditService: AuditService;
  readonly scheduler: SchedulerPort;
  readonly toolRegistry: ToolRegistry;
  private readonly toolResolver: RegistryToolResolver;
  private readonly toolExecutor: OrchestratorToolExecutor;

  constructor(private readonly deps: GatewayDeps) {
    this.bus = deps.bus;
    this.agentRegistry = new AgentRegistry(deps.bus);
    this.capabilityRegistry = new GlobalCapabilityRegistry(deps.bus);
    this.auditService = new AuditService(deps.auditStore, deps.bus);
    this.scheduler = deps.scheduler;
    this.taskOrchestrator = new TaskOrchestrator(
      this.agentRegistry,
      this.capabilityRegistry,
      deps.connectionManager,
      deps.bus,
    );
    this.toolRegistry = new CapabilityBackedToolRegistry(this.capabilityRegistry);
    this.toolResolver = new RegistryToolResolver(this.toolRegistry);
    this.toolExecutor = new OrchestratorToolExecutor(this.taskOrchestrator, this.auditService, deps.bus);
  }

  bootstrap(): void {
    this.deps.connectionManager.onAgentConnected((info) => {
      // upsert() registra la identidad/capacidades aprendidas del hello;
      // markOnline() es la única responsable de status/lastSeenAt (hallazgo
      // M14 de docs/13 — antes ambas escribían "online", redundante y confuso).
      const record: AgentRecord = {
        edgeAgentId: info.edgeAgentId,
        status: "offline",
        protocolVersion: info.protocolVersion,
        os: info.hello.os,
        agentVersion: info.hello.agentVersion,
        installedPlugins: info.hello.installedPlugins,
        devices: dedupeDevices(info.hello.capabilities),
        lastSeenAt: info.connectedAt,
      };
      this.agentRegistry.upsert(record);
      this.agentRegistry.markOnline(info.edgeAgentId);
      this.capabilityRegistry.sync(info.edgeAgentId, info.hello.capabilities);
    });

    this.deps.connectionManager.onAgentDisconnected((edgeAgentId) => {
      this.agentRegistry.markOffline(edgeAgentId);
      this.capabilityRegistry.removeAgent(edgeAgentId);
    });

    this.deps.connectionManager.onMessage((edgeAgentId, message) => {
      if (message.type === "telemetry") {
        this.taskOrchestrator.handleTelemetry(message);
        return;
      }
      if (message.type === "safety_policy.changed") {
        // El cambio ya ocurrió y se persistió localmente en el Edge Agent;
        // esto solo deja constancia en la auditoría (regla 7 de Safety Policy).
        this.auditService.record({
          actor: "user",
          action: "safety_policy.changed",
          subject: `${edgeAgentId}/${message.deviceId}/${message.target}`,
          metadata: { alias: message.alias, severity: message.severity, previousSeverity: message.previousSeverity },
        });
        return;
      }
      // "heartbeat" solo mantiene viva la conexión (ConnectionManagerPort lo maneja internamente).
    });

    this.deps.connectionManager.start();

    this.deps.scheduler.start(async (taskRequest, jobId) => {
      this.bus.emit("job.fired", { jobId, capabilityRef: taskRequest.capabilityRef });
      this.auditService.record({
        actor: "system",
        action: "job.fired",
        subject: taskRequest.capabilityRef,
        metadata: { jobId },
      });
      return this.taskOrchestrator.submit(taskRequest);
    });
  }

  shutdown(): void {
    this.deps.connectionManager.stop();
    this.deps.scheduler.stop();
  }

  listTools(): ToolDescriptor[] {
    return this.toolRegistry.list();
  }

  async executeTool(name: string, args: unknown): Promise<ToolExecutionResult> {
    const resolution = this.toolResolver.resolve(name, args);
    if (!resolution.ok) {
      return { success: false, error: resolution.error };
    }
    return this.toolExecutor.execute(resolution.call);
  }
}

function dedupeDevices(
  capabilities: Array<{ deviceId: string; deviceName: string }>,
): AgentRecord["devices"] {
  const seen = new Map<string, AgentRecord["devices"][number]>();
  for (const { deviceId, deviceName } of capabilities) {
    if (!seen.has(deviceId)) {
      seen.set(deviceId, { id: deviceId, name: deviceName, kind: "unknown" });
    }
  }
  return Array.from(seen.values());
}
