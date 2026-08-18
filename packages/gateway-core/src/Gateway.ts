import type { AgentRecord } from "./domain/entities/AgentRecord";
import type { ConnectionManagerPort } from "./domain/ports/ConnectionManagerPort";
import type { AuditStorePort } from "./domain/ports/AuditStorePort";
import type { SchedulerPort } from "./domain/ports/SchedulerPort";
import type { NotificationServicePort } from "./domain/ports/NotificationServicePort";
import type { AgentRegistryStorePort } from "./domain/ports/AgentRegistryStorePort";
import type { TaskStorePort } from "./domain/ports/TaskStorePort";
import type { GatewayBus } from "./application/GatewayBus";
import type { DeviceEnrichmentService } from "./application/DeviceEnrichmentService";
import { AgentRegistry } from "./application/AgentRegistry";
import { GlobalCapabilityRegistry } from "./application/GlobalCapabilityRegistry";
import { TaskOrchestrator } from "./application/TaskOrchestrator";
import { ConfirmationOrchestrator, type ResolveConfirmationResult } from "./application/ConfirmationOrchestrator";
import { AuditService } from "./application/AuditService";
import { CapabilityBackedToolRegistry, type ToolRegistry } from "./application/ToolRegistry";
import { RegistryToolResolver } from "./application/ToolResolver";
import { OrchestratorToolExecutor } from "./application/ToolExecutor";
import { SCHEDULER_TOOL_DESCRIPTORS, isSchedulerToolName, executeSchedulerTool } from "./application/schedulerTools";
import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";

export interface GatewayDeps {
  bus: GatewayBus;
  connectionManager: ConnectionManagerPort;
  auditStore: AuditStorePort;
  scheduler: SchedulerPort;
  notificationService: NotificationServicePort;
  /** Investigación automática de dispositivos nuevos (ADR-053) — ausente si no hay GEMINI_API_KEY configurada, mismo criterio que geminiLiveProxy en server.ts. */
  deviceEnrichmentService?: DeviceEnrichmentService;
  /** Fix de auditoría de backend #2 — sin esto, AgentRegistry/TaskOrchestrator son puramente en memoria (comportamiento previo, retrocompatible). */
  agentRegistryStore?: AgentRegistryStorePort;
  taskStore?: TaskStorePort;
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
  readonly confirmationOrchestrator: ConfirmationOrchestrator;
  readonly auditService: AuditService;
  readonly scheduler: SchedulerPort;
  readonly toolRegistry: ToolRegistry;
  private readonly toolResolver: RegistryToolResolver;
  private readonly toolExecutor: OrchestratorToolExecutor;

  constructor(private readonly deps: GatewayDeps) {
    this.bus = deps.bus;
    this.agentRegistry = new AgentRegistry(deps.bus, deps.agentRegistryStore);
    // agentRegistry inyectado (P2 incremento 4): permite que list()/resolve
    // de capacidades sepan a qué usuario pertenece cada Edge Agent.
    this.capabilityRegistry = new GlobalCapabilityRegistry(deps.bus, this.agentRegistry);
    this.auditService = new AuditService(deps.auditStore, deps.bus);
    this.scheduler = deps.scheduler;
    this.taskOrchestrator = new TaskOrchestrator(
      this.agentRegistry,
      this.capabilityRegistry,
      deps.connectionManager,
      deps.bus,
      deps.taskStore,
    );
    this.confirmationOrchestrator = new ConfirmationOrchestrator(deps.connectionManager, this.agentRegistry);
    this.toolRegistry = new CapabilityBackedToolRegistry(this.capabilityRegistry);
    this.toolResolver = new RegistryToolResolver(this.toolRegistry);
    this.toolExecutor = new OrchestratorToolExecutor(this.taskOrchestrator, this.confirmationOrchestrator, this.auditService, deps.bus);
  }

  bootstrap(): void {
    // Mismo criterio que job.fired/job.notification (ver el callback del
    // scheduler más abajo): quien dispara el evento (DeviceEnrichmentService)
    // nunca conoce AuditService directo — evitaría una dependencia circular,
    // porque AuditService lo construye el propio Gateway en su constructor,
    // antes de que DeviceEnrichmentService pueda existir.
    this.bus.on("device.enriched", ({ ownerId, deviceKind, deviceNames, sources }) => {
      this.auditService.record({
        actor: "system",
        action: "device.enriched",
        subject: deviceKind,
        userId: ownerId,
        metadata: { deviceNames, sources },
      });
    });

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
        ownerId: info.ownerId,
      };
      this.agentRegistry.upsert(record);
      this.agentRegistry.markOnline(info.edgeAgentId);
      this.capabilityRegistry.sync(info.edgeAgentId, info.hello.capabilities);

      // Nunca bloquea la conexión — enrichIfNew() corre en background y ya
      // absorbe sus propios errores (ADR-053). Sin ownerId (agente todavía
      // no vinculado), no hace nada.
      this.deps.deviceEnrichmentService?.enrichIfNew(
        info.ownerId,
        record.devices.map((device) => ({ kind: device.kind, name: device.name })),
      );
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
      if (message.type === "confirmation_resolved") {
        this.confirmationOrchestrator.handleResolved(message);
        return;
      }
      if (message.type === "safety_policy.changed") {
        // El cambio ya ocurrió y se persistió localmente en el Edge Agent;
        // esto solo deja constancia en la auditoría (regla 7 de Safety Policy).
        // userId (P2 incremento 5): el owner del agente — no hay sesión
        // propia en apps/desktop, es la mejor aproximación disponible de
        // "quién hizo esto".
        this.auditService.record({
          actor: "user",
          action: "safety_policy.changed",
          subject: `${edgeAgentId}/${message.deviceId}/${message.target}`,
          userId: this.agentRegistry.get(edgeAgentId)?.ownerId,
          metadata: { alias: message.alias, severity: message.severity, previousSeverity: message.previousSeverity },
        });
        return;
      }
      if (message.type === "audit.local") {
        // Invocación manual desde apps/desktop (docs/16 P4, ADR-025) — la
        // ejecución ya ocurrió del lado del Edge Agent, esto solo la deja
        // en la auditoría con actor "user" (a diferencia de "llm" del chat).
        this.auditService.record({
          actor: "user",
          action: "audit.local",
          subject: `${edgeAgentId}/${message.deviceId}/${message.capability}`,
          userId: this.agentRegistry.get(edgeAgentId)?.ownerId,
          metadata: { success: message.success, error: message.error },
        });
        return;
      }
      // "heartbeat" solo mantiene viva la conexión (ConnectionManagerPort lo maneja internamente).
    });

    this.deps.connectionManager.start();

    this.deps.scheduler.start(async (job) => {
      let failed = false;

      for (const step of job.steps) {
        this.bus.emit("job.fired", { jobId: job.id, capabilityRef: step.capabilityRef });
        // userId (P2 incremento 5): el owner del agente que este paso
        // específico toca — informativo, no le da un dueño al job en sí
        // (fuera de alcance, ver docs/19 incremento 4).
        const stepEdgeAgentId = this.capabilityRegistry.resolve(step.capabilityRef)?.edgeAgentId;
        this.auditService.record({
          actor: "system",
          action: "job.fired",
          subject: step.capabilityRef,
          userId: stepEdgeAgentId ? this.agentRegistry.get(stepEdgeAgentId)?.ownerId : undefined,
          metadata: { jobId: job.id },
        });

        const result = await this.taskOrchestrator.submit(step);
        if (result.status === "failed") {
          failed = true;
          this.bus.emit("job.step_failed", { jobId: job.id, capabilityRef: step.capabilityRef, error: result.error ?? "error desconocido" });
          break; // "acciones combinadas" se ejecutan en orden; un paso fallido no dispara los siguientes (ADR-021).
        }
      }

      if (job.notification) {
        this.bus.emit("job.notification", { jobId: job.id, title: job.notification.title });
        this.auditService.record({
          actor: "system",
          action: "job.notification",
          subject: job.notification.title,
          metadata: { jobId: job.id, body: job.notification.body, failed },
        });
        await this.deps.notificationService.notify({
          userId: job.createdBy ?? "system",
          channel: "chat",
          title: job.notification.title,
          body: job.notification.body,
          severity: failed ? "warning" : "info",
        });
      }
    });
  }

  shutdown(): void {
    this.deps.connectionManager.stop();
    this.deps.scheduler.stop();
  }

  listTools(requestingUserId?: string): ToolDescriptor[] {
    // Tools de automatizaciones (ADR-039) — no son capability de ningún
    // dispositivo, así que no pasan por toolRegistry; siempre disponibles.
    return [...this.toolRegistry.list(requestingUserId), ...SCHEDULER_TOOL_DESCRIPTORS];
  }

  /**
   * `requestingUserId` (P2 incremento 4): si la capability resuelta
   * pertenece a un Edge Agent ya vinculado a otro usuario, se rechaza
   * antes de llegar al `ToolExecutor` — nunca dispatchea al dispositivo
   * físico. Un agente sin vincular (`ownerId` undefined) sigue abierto
   * para cualquiera, igual que antes de este incremento. `TaskOrchestrator.
   * submit()` no lleva este chequeo a propósito: los jobs programados lo
   * llaman directo, sin request HTTP de por medio, nunca van a tener un
   * `requestingUserId`.
   */
  async executeTool(name: string, args: unknown, requestingUserId?: string): Promise<ToolExecutionResult> {
    // ADR-039: se despachan acá, antes de tocar toolResolver/capabilityRegistry
    // — un job programado no es de ningún dispositivo, no aplica el chequeo
    // de ownership de abajo.
    if (isSchedulerToolName(name)) {
      return executeSchedulerTool(this.scheduler, name, args, requestingUserId);
    }

    const resolution = this.toolResolver.resolve(name, args);
    if (!resolution.ok) {
      return { success: false, error: resolution.error };
    }

    const capability = this.capabilityRegistry.resolve(resolution.call.ref);
    if (!capability) {
      return { success: false, error: `Capability desconocida: ${resolution.call.ref}` };
    }

    const ownerId = this.agentRegistry.get(capability.edgeAgentId)?.ownerId;
    if (ownerId !== undefined && ownerId !== requestingUserId) {
      this.auditService.record({
        actor: "user",
        action: "tool.execute.denied",
        subject: resolution.call.ref,
        userId: requestingUserId,
        metadata: { requestingUserId, ownerId },
      });
      return { success: false, error: "No autorizado: este dispositivo pertenece a otro usuario." };
    }

    return this.toolExecutor.execute(resolution.call, capability, requestingUserId);
  }

  /**
   * ADR-059: resuelve remotamente una confirmación pendiente (irreversible-
   * material/safety-critical) — hasta este incremento, solo `apps/desktop`
   * podía hacerlo, vía IPC local. La autorización (¿esta confirmación es de
   * este usuario?) vive en `ConfirmationOrchestrator.resolve()`.
   */
  async resolveConfirmation(confirmationId: string, approved: boolean, requestingUserId?: string): Promise<ResolveConfirmationResult | undefined> {
    return this.confirmationOrchestrator.resolve(confirmationId, approved, requestingUserId);
  }
}

function dedupeDevices(
  capabilities: Array<{ deviceId: string; deviceName: string; deviceKind: string }>,
): AgentRecord["devices"] {
  const seen = new Map<string, AgentRecord["devices"][number]>();
  for (const { deviceId, deviceName, deviceKind } of capabilities) {
    if (!seen.has(deviceId)) {
      seen.set(deviceId, { id: deviceId, name: deviceName, kind: deviceKind });
    }
  }
  return Array.from(seen.values());
}
