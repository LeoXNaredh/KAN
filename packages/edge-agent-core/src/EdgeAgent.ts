import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { ActionSeverity, AgentTaskDispatchMessage, TargetDescriptor } from "@kan/plugin-contract";
import type { InstalledPlugin } from "./domain/entities/InstalledPlugin";
import type { ConfigStorePort } from "./domain/ports/ConfigStorePort";
import type { LoggerPort } from "./domain/ports/LoggerPort";
import type { CoreConnectionPort } from "./domain/ports/CoreConnectionPort";
import type { UpdaterPort } from "./domain/ports/UpdaterPort";
import type { PluginPackageExtractorPort } from "./domain/ports/PluginPackageExtractorPort";
import type { PluginPackageFetcherPort } from "./domain/ports/PluginPackageFetcherPort";
import type { ProcessLauncherPort } from "./domain/ports/ProcessLauncherPort";
import type { VenvManagerPort } from "./domain/ports/VenvManagerPort";
import type { SafetyPolicyEntry } from "./domain/entities/SafetyPolicyEntry";
import type { EdgeAgentBus } from "./application/EdgeAgentBus";
import { PluginManager } from "./application/PluginManager";
import { PluginInstaller } from "./application/PluginInstaller";
import { DeviceManager } from "./application/DeviceManager";
import { PermissionManager } from "./application/PermissionManager";
import { SafetyPolicyStore } from "./application/SafetyPolicyStore";
import { CapabilityRegistry, type CapabilityListing, type InvokeOutcome, type ConfirmedOutcome } from "./application/CapabilityRegistry";

/**
 * Dependencias del sistema de plugins bajo demanda (ADR-056, Fase 3) — las
 * cuatro juntas, opcionales: sin ellas, `EdgeAgent` funciona exactamente
 * como antes (sin `installPlugin`/`uninstallPlugin`), para no romper
 * ningún host existente. `apps/desktop` las provee recién en Fase 5.
 */
export interface PluginInstallerConfig {
  pluginPackageFetcher: PluginPackageFetcherPort;
  pluginPackageExtractor: PluginPackageExtractorPort;
  venvManager: VenvManagerPort;
  processLauncher: ProcessLauncherPort;
  pluginsDir: string;
}

export interface SafetyTargetListing extends TargetDescriptor {
  alias?: string;
  effectiveSeverity: ActionSeverity;
  configured: boolean;
}

export interface EdgeAgentDeps {
  edgeAgentId: string;
  agentVersion: string;
  /** Quien compone el Edge Agent decide esto — en Node, `os.platform()`; en el navegador no aplica. */
  os?: string;
  bus: EdgeAgentBus;
  logger: LoggerPort;
  configStore: ConfigStorePort;
  coreConnection: CoreConnectionPort;
  updater: UpdaterPort;
  /** ADR-056 (Fase 3) — opcional a propósito, ver `PluginInstallerConfig`. */
  pluginInstaller?: PluginInstallerConfig;
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
  private readonly pluginInstaller: PluginInstaller | undefined;

  constructor(private readonly deps: EdgeAgentDeps) {
    this.bus = deps.bus;
    this.pluginManager = new PluginManager(deps.bus, deps.logger, deps.configStore);
    this.deviceManager = new DeviceManager(deps.bus, deps.logger);
    if (deps.pluginInstaller) {
      this.pluginInstaller = new PluginInstaller({
        pluginManager: this.pluginManager,
        bus: deps.bus,
        logger: deps.logger,
        configStore: deps.configStore,
        fetcher: deps.pluginInstaller.pluginPackageFetcher,
        extractor: deps.pluginInstaller.pluginPackageExtractor,
        venvManager: deps.pluginInstaller.venvManager,
        processLauncher: deps.pluginInstaller.processLauncher,
        pluginsDir: deps.pluginInstaller.pluginsDir,
      });
    }
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

  /** Plugins registrados a los que les falta aprobación de permisos (P8, ADR-041). */
  listPendingPluginPermissions() {
    return this.pluginManager.listPendingPermissions();
  }

  /**
   * Aprueba los permisos de un plugin pendiente y lo habilita. El
   * descubrimiento de sus dispositivos corre de inmediato para ese driver
   * solo — sin reiniciar la app ni volver a descubrir los demás.
   */
  async approvePluginPermissions(pluginId: string): Promise<void> {
    const driver = await this.pluginManager.approve(pluginId);
    if (driver) await this.deviceManager.discoverAll([driver]);
  }

  rejectPluginPermissions(pluginId: string): void {
    this.pluginManager.reject(pluginId);
  }

  /**
   * Vuelve a correr discover() en todos los plugins habilitados — misma
   * línea que ya corre una vez en `bootstrap()`, expuesta como método
   * público para cuando la config de un plugin cambió en caliente (ej.
   * sincronizar `KAN_*` nuevos desde /configuracion, ver `apps/desktop`) y
   * hace falta que lo tome sin reiniciar el proceso. Mismo patrón que
   * `approvePluginPermissions()`, que ya hace este mismo llamado para un
   * driver recién aprobado.
   */
  async rediscoverDevices(): Promise<void> {
    await this.deviceManager.discoverAll(this.pluginManager.getEnabledDrivers());
  }

  /** Plugins sidecar instalados (ADR-056) — `undefined` si este host no pasó `pluginInstaller` en `EdgeAgentDeps`. */
  listInstalledPlugins(): InstalledPlugin[] | undefined {
    return this.pluginInstaller?.listInstalled();
  }

  /** Descarga, instala y registra un plugin sidecar. Dispara el mismo flujo de aprobación de permisos que cualquier plugin (`plugin.permission_pending`). */
  async installPlugin(pluginId: string): Promise<InstalledPlugin> {
    if (!this.pluginInstaller) {
      throw new Error("Este Edge Agent no tiene configurado el instalador de plugins (falta pluginInstaller en EdgeAgentDeps).");
    }
    const installed = await this.pluginInstaller.install(pluginId);
    await this.deviceManager.discoverAll(this.pluginManager.getEnabledDrivers());
    return installed;
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    if (!this.pluginInstaller) {
      throw new Error("Este Edge Agent no tiene configurado el instalador de plugins (falta pluginInstaller en EdgeAgentDeps).");
    }
    await this.pluginInstaller.uninstall(pluginId);
  }

  async bootstrap(): Promise<void> {
    // Reconstruye cada sidecar instalado ANTES de descubrir dispositivos —
    // mismo lugar donde hoy se registran estáticamente los plugins
    // in-process en apps/desktop, ahora dinámico (ADR-056).
    await this.pluginInstaller?.restoreInstalled();
    await this.deviceManager.discoverAll(this.pluginManager.getEnabledDrivers());

    this.deps.coreConnection.onMessage((message) => this.handleCoreMessage(message));
    this.deps.coreConnection.onStatusChange((status) => {
      if (status === "connected") {
        this.deps.coreConnection.send({
          type: "hello",
          protocolVersion: "1.0.0",
          edgeAgentId: this.deps.edgeAgentId,
          os: this.deps.os,
          agentVersion: this.deps.agentVersion,
          installedPlugins: this.pluginManager.list().map((instance) => instance.manifest),
          capabilities: this.capabilityRegistry
            .list()
            .map((c) => ({ deviceId: c.deviceId, deviceName: c.deviceName, deviceKind: c.deviceKind, capability: c.capability })),
          // Presente solo si este agente ya fue vinculado a un usuario
          // (docs/19 P2, incremento 3) — ausente, se conecta igual que
          // siempre, sin ownerId.
          pairingToken: this.deps.configStore.get<string>("pairingToken"),
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

  /**
   * Resuelve una acción que había quedado `pending_confirmation` (fix de
   * auditoría de backend): antes esto no dejaba rastro — el comentario
   * histórico en `invokeCapability()` lo marcaba como "trabajo futuro".
   * Mismo mecanismo que `invokeCapability()` (`audit.local` → Gateway lo
   * graba con `actor: "user"`, ver `Gateway.ts`), y mismo criterio de
   * alcance: solo si la acción efectivamente se ejecutó (aprobada) o quedó
   * en error; un rechazo (`approved: false`) no ejecuta nada, así que
   * `executeConfirmed()` no devuelve un outcome "executed" para auditar.
   */
  async resolveConfirmation(confirmationId: string, approved: boolean): Promise<ConfirmedOutcome | undefined> {
    const outcome = await this.capabilityRegistry.executeConfirmed(confirmationId, approved);
    if (outcome) {
      this.deps.coreConnection.send({
        type: "audit.local",
        deviceId: outcome.deviceId,
        capability: outcome.capabilityName,
        success: outcome.result.success,
        error: outcome.result.error,
        at: new Date().toISOString(),
      });
    }
    return outcome;
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
