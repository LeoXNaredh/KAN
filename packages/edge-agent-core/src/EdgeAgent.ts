import { platform } from "node:os";
import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { ActionSeverity, AgentTaskDispatchMessage, TargetDescriptor } from "@kan/plugin-contract";
import type { ConfigStorePort } from "./domain/ports/ConfigStorePort";
import type { LoggerPort } from "./domain/ports/LoggerPort";
import type { CoreConnectionPort } from "./domain/ports/CoreConnectionPort";
import type { UpdaterPort } from "./domain/ports/UpdaterPort";
import type { SafetyPolicyEntry } from "./domain/entities/SafetyPolicyEntry";
import type { EdgeAgentBus } from "./application/EdgeAgentBus";
import { PluginManager } from "./application/PluginManager";
import { DeviceManager } from "./application/DeviceManager";
import { PermissionManager } from "./application/PermissionManager";
import { SafetyPolicyStore } from "./application/SafetyPolicyStore";
import { CapabilityRegistry, type CapabilityListing, type InvokeOutcome } from "./application/CapabilityRegistry";

export interface SafetyTargetListing extends TargetDescriptor {
  alias?: string;
  effectiveSeverity: ActionSeverity;
  configured: boolean;
}

export interface EdgeAgentDeps {
  edgeAgentId: string;
  agentVersion: string;
  bus: EdgeAgentBus;
  logger: LoggerPort;
  configStore: ConfigStorePort;
  coreConnection: CoreConnectionPort;
  updater: UpdaterPort;
}

/**
 * Composition root de la lógica del Edge Agent (requisito 1, arquitectura
 * modular): une Plugin Manager, Device Manager, Permission Manager y
 * Capability Registry, y expone una fachada única para quien lo hospede
 * (hoy `apps/desktop`, mañana potencialmente otro host).
 */
export class EdgeAgent {
  readonly bus: EdgeAgentBus;
  private readonly pluginManager: PluginManager;
  private readonly deviceManager: DeviceManager;
  private readonly permissionManager: PermissionManager;
  private readonly safetyPolicyStore: SafetyPolicyStore;
  private readonly capabilityRegistry: CapabilityRegistry;

  constructor(private readonly deps: EdgeAgentDeps) {
    this.bus = deps.bus;
    this.pluginManager = new PluginManager(deps.bus, deps.logger, deps.configStore);
    this.deviceManager = new DeviceManager(deps.bus, deps.logger);
    this.permissionManager = new PermissionManager(deps.bus, deps.logger);
    this.safetyPolicyStore = new SafetyPolicyStore(deps.configStore, deps.bus);
    this.capabilityRegistry = new CapabilityRegistry(
      this.deviceManager,
      this.permissionManager,
      this.safetyPolicyStore,
      deps.bus,
      deps.logger,
    );

    // Reenvía cada cambio de Safety Policy al Gateway para que quede en la
    // auditoría (regla 7) — el cambio en sí ya se persistió localmente.
    this.bus.on("safety_policy.changed", ({ entry, previousSeverity }) => {
      this.deps.coreConnection.send({
        type: "safety_policy.changed",
        deviceId: entry.deviceId,
        target: entry.target,
        alias: entry.alias,
        severity: entry.severity,
        previousSeverity,
        at: entry.updatedAt,
      });
    });
  }

  async registerPlugin(driver: KanDeviceDriverPlugin): Promise<void> {
    await this.pluginManager.register(driver);
  }

  async bootstrap(): Promise<void> {
    await this.deviceManager.discoverAll(this.pluginManager.getEnabledDrivers());

    this.deps.coreConnection.onMessage((message) => this.handleCoreMessage(message));
    this.deps.coreConnection.onStatusChange((status) => {
      if (status === "connected") {
        this.deps.coreConnection.send({
          type: "hello",
          protocolVersion: "1.0.0",
          edgeAgentId: this.deps.edgeAgentId,
          os: platform(),
          agentVersion: this.deps.agentVersion,
          installedPlugins: this.pluginManager.list().map((instance) => instance.manifest),
          capabilities: this.capabilityRegistry
            .list()
            .map((c) => ({ deviceId: c.deviceId, deviceName: c.deviceName, capability: c.capability })),
        });
      }
    });
    this.deps.coreConnection.start();

    this.deps.logger.info("Edge Agent listo");
  }

  async shutdown(): Promise<void> {
    this.deps.coreConnection.stop();
  }

  listDevices() {
    return this.deviceManager.list();
  }

  listCapabilities(): CapabilityListing[] {
    return this.capabilityRegistry.list();
  }

  async invokeCapability(deviceId: string, capabilityName: string, input: unknown): Promise<InvokeOutcome> {
    const outcome = await this.capabilityRegistry.invoke(deviceId, capabilityName, input);
    // Solo el camino "manual" (invocado directo desde apps/desktop, no
    // despachado por el Gateway) necesita este aviso — handleCoreMessage()
    // ya queda auditado del lado del Gateway como actor "llm" (ToolExecutor).
    // Alcance limitado a ejecución inmediata (docs/16 P4, ADR-025): una
    // acción que queda pending_confirmation todavía no tiene resultado que
    // auditar; se audita si/cuando se confirma es trabajo futuro.
    if (outcome.status === "executed") {
      this.deps.coreConnection.send({
        type: "audit.local",
        deviceId,
        capability: capabilityName,
        success: outcome.result.success,
        error: outcome.result.error,
        at: new Date().toISOString(),
      });
    }
    return outcome;
  }

  resolveConfirmation(confirmationId: string, approved: boolean): Promise<InvokeOutcome | undefined> {
    return this.capabilityRegistry.executeConfirmed(confirmationId, approved);
  }

  getCoreConnectionStatus() {
    return this.deps.coreConnection.status;
  }

  /**
   * Targets conocidos de un dispositivo (ej. sus pines) mezclados con la
   * Safety Policy ya configurada, para que la app de escritorio pueda
   * mostrar de un vistazo qué está clasificado y qué sigue en el default.
   */
  listSafetyTargets(deviceId: string): SafetyTargetListing[] {
    const driver = this.deviceManager.getDriverFor(deviceId);
    const known = driver?.listTargets(deviceId) ?? [];
    return known.map((target) => {
      const override = this.safetyPolicyStore.get(deviceId, target.target);
      return {
        target: target.target,
        suggestedAlias: target.suggestedAlias,
        defaultSeverity: target.defaultSeverity,
        alias: override?.alias,
        effectiveSeverity: override?.severity ?? target.defaultSeverity,
        configured: override !== undefined,
      };
    });
  }

  setSafetyPolicy(deviceId: string, target: string, severity: ActionSeverity, alias?: string): SafetyPolicyEntry {
    return this.safetyPolicyStore.set(deviceId, target, { severity, alias });
  }

  private async handleCoreMessage(message: AgentTaskDispatchMessage): Promise<void> {
    const outcome = await this.capabilityRegistry.invoke(message.deviceId, message.capability, message.payload);

    if (outcome.status === "executed") {
      this.deps.coreConnection.send({
        type: "telemetry",
        taskId: message.taskId,
        status: outcome.result.success ? "done" : "failed",
        data: outcome.result.data,
        error: outcome.result.error,
        at: new Date().toISOString(),
      });
      return;
    }

    // "pending_confirmation": se avisa de inmediato al Gateway para que no
    // espere el timeout — la confirmación real ocurre en esta misma app
    // (ver docs/12 §4: decisión de seguridad deliberada, no una limitación).
    this.deps.coreConnection.send({
      type: "telemetry",
      taskId: message.taskId,
      status: "pending_confirmation",
      confirmationId: outcome.confirmationId,
      at: new Date().toISOString(),
    });
  }
}
