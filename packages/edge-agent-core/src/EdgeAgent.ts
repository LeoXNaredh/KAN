import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { AgentTaskDispatchMessage } from "@kan/plugin-contract";
import type { ConfigStorePort } from "./domain/ports/ConfigStorePort";
import type { LoggerPort } from "./domain/ports/LoggerPort";
import type { CoreConnectionPort } from "./domain/ports/CoreConnectionPort";
import type { UpdaterPort } from "./domain/ports/UpdaterPort";
import { EdgeAgentBus } from "./application/EdgeAgentBus";
import { PluginManager } from "./application/PluginManager";
import { DeviceManager } from "./application/DeviceManager";
import { PermissionManager } from "./application/PermissionManager";
import { CapabilityRegistry, type CapabilityListing, type InvokeOutcome } from "./application/CapabilityRegistry";

export interface EdgeAgentDeps {
  edgeAgentId: string;
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
  private readonly capabilityRegistry: CapabilityRegistry;

  constructor(private readonly deps: EdgeAgentDeps) {
    this.bus = deps.bus;
    this.pluginManager = new PluginManager(deps.bus, deps.logger, deps.configStore);
    this.deviceManager = new DeviceManager(deps.bus, deps.logger);
    this.permissionManager = new PermissionManager(deps.bus, deps.logger);
    this.capabilityRegistry = new CapabilityRegistry(
      this.deviceManager,
      this.permissionManager,
      deps.bus,
      deps.logger,
    );
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
          capabilities: this.capabilityRegistry
            .list()
            .map((c) => ({ deviceId: c.deviceId, capability: c.capability })),
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

  invokeCapability(deviceId: string, capabilityName: string, input: unknown): Promise<InvokeOutcome> {
    return this.capabilityRegistry.invoke(deviceId, capabilityName, input);
  }

  resolveConfirmation(confirmationId: string, approved: boolean): Promise<InvokeOutcome | undefined> {
    return this.capabilityRegistry.executeConfirmed(confirmationId, approved);
  }

  getCoreConnectionStatus() {
    return this.deps.coreConnection.status;
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
    }
    // Si queda "pending_confirmation", la telemetría se envía cuando se
    // resuelva desde la UI local — fuera de alcance de este incremento
    // (no hay servidor de Core todavía que reciba ese follow-up).
  }
}
