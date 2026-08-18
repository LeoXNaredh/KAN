import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { ActionSeverity, CoreToEdgeMessage, TargetDescriptor } from "@kan/plugin-contract";
import type { InstalledPlugin } from "./domain/entities/InstalledPlugin";
import type { KnownDeviceRecord } from "./domain/entities/KnownDevice";
import type { ConfigStorePort } from "./domain/ports/ConfigStorePort";
import type { DeviceStorePort } from "./domain/ports/DeviceStorePort";
import type { LoggerPort } from "./domain/ports/LoggerPort";
import type { CoreConnectionPort } from "./domain/ports/CoreConnectionPort";
import type { UpdaterPort } from "./domain/ports/UpdaterPort";
import type { SafetyPolicyEntry } from "./domain/entities/SafetyPolicyEntry";
import type { EdgeAgentBus } from "./application/EdgeAgentBus";
import { PluginManager } from "./application/PluginManager";
import type { PluginInstaller } from "./application/PluginInstaller";
import { DeviceManager } from "./application/DeviceManager";
import { PermissionManager } from "./application/PermissionManager";
import { SafetyPolicyStore } from "./application/SafetyPolicyStore";
import { CapabilityRegistry, type CapabilityListing, type InvokeOutcome, type ConfirmedOutcome } from "./application/CapabilityRegistry";

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
  /** Memoria de dispositivos entre reinicios — opcional (ej. `browser.ts`, sin filesystem, no la pasa). */
  deviceStore?: DeviceStorePort;
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
  private pluginInstaller: PluginInstaller | undefined;

  constructor(private readonly deps: EdgeAgentDeps) {
    this.bus = deps.bus;
    this.pluginManager = new PluginManager(deps.bus, deps.logger, deps.configStore);
    this.deviceManager = new DeviceManager(deps.bus, deps.logger, deps.deviceStore);
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

  /**
   * `PluginManager` en sí es browser-safe (solo depende de ports), pero
   * `PluginInstaller` arrastra `SidecarProxyPlugin` → `PythonVenvManager`
   * (`node:child_process`) — inconstruible para un host de navegador
   * (`browser.ts`, el Simulador de docs/19), incluso con `import()`
   * dinámico: Turbopack igual necesita resolver ese chunk. Por eso
   * `EdgeAgent` nunca importa `PluginInstaller` como valor — quien lo
   * necesite (hoy solo `apps/desktop`) lo construye con este
   * `PluginManager` y lo engancha después de crear el `EdgeAgent`.
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /** Ver `getPluginManager()` — instancia ya construida por el host (`apps/desktop`), nunca por `EdgeAgent`. */
  attachPluginInstaller(pluginInstaller: PluginInstaller): void {
    this.pluginInstaller = pluginInstaller;
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

  /**
   * Igual que `rediscoverDevices()` pero acotado a un único plugin — para
   * detección en caliente por polling frecuente (ADR-060 incremento 2, ej.
   * `kan-device-discovery` sondeado cada pocos segundos desde
   * `apps/desktop`). A propósito no reusa `rediscoverDevices()`: llamar
   * discover() en TODOS los drivers habilitados en cada tick de un poll
   * corto repetiría trabajo real innecesario en drivers que sí hacen I/O de
   * verdad en discover() (ej. sondear un dispositivo de red). No hace nada
   * si el plugin no existe o no está habilitado (pendiente de aprobación,
   * deshabilitado, o id inexistente) — mismo criterio best-effort del resto
   * de este archivo, un poll en background nunca debe lanzar.
   */
  async rediscoverDriver(pluginId: string): Promise<void> {
    const driver = this.pluginManager.getEnabledDrivers().find((d) => d.id === pluginId);
    if (!driver) return;
    await this.deviceManager.discoverAll([driver]);
  }

  /** Plugins sidecar instalados (ADR-056) — `undefined` si este host no pasó `pluginInstaller` en `EdgeAgentDeps`. */
  listInstalledPlugins(): InstalledPlugin[] | undefined {
    return this.pluginInstaller?.listInstalled();
  }

  /** Descarga, instala y registra un plugin sidecar. Dispara el mismo flujo de aprobación de permisos que cualquier plugin (`plugin.permission_pending`). */
  async installPlugin(pluginId: string): Promise<InstalledPlugin> {
    if (!this.pluginInstaller) {
      throw new Error("Este Edge Agent no tiene un instalador de plugins enganchado (ver attachPluginInstaller()).");
    }
    const installed = await this.pluginInstaller.install(pluginId);
    await this.deviceManager.discoverAll(this.pluginManager.getEnabledDrivers());
    return installed;
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    if (!this.pluginInstaller) {
      throw new Error("Este Edge Agent no tiene un instalador de plugins enganchado (ver attachPluginInstaller()).");
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

  /** Dispositivos vistos alguna vez (memoria entre reinicios), incluyendo los desconectados ahora mismo — ver `DeviceManager.listKnown()`. */
  listKnownDevices(): KnownDeviceRecord[] {
    return this.deviceManager.listKnown();
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
   * graba con `actor: "user"`, ver `Gateway.ts`) — `executeConfirmed()`
   * siempre devuelve un `ConfirmedOutcome` definido, tanto si se aprueba
   * (se ejecuta) como si se rechaza (`result = {success:false, error:
   * "Rechazado por el usuario"}`), así que ambos casos quedan auditados acá
   * por igual; solo queda sin auditar si `confirmationId` no existe/ya venció.
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

  private async handleCoreMessage(message: CoreToEdgeMessage): Promise<void> {
    if (message.type === "agent_confirmation.resolve") {
      await this.handleConfirmationResolve(message.confirmationId, message.approved);
      return;
    }

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

  /**
   * ADR-059: mismo `resolveConfirmation()` que ya usaba el IPC local de
   * `apps/desktop`, ahora también disparable en remoto (Gateway → chat web /
   * voz) — el Edge Agent no distingue quién pidió la confirmación, solo que
   * llegó por el canal correcto. Correlacionado por `confirmationId`, no por
   * `taskId` (esa tarea ya terminó del lado del Gateway cuando quedó
   * "pending_confirmation").
   */
  private async handleConfirmationResolve(confirmationId: string, approved: boolean): Promise<void> {
    const outcome = await this.resolveConfirmation(confirmationId, approved);
    this.deps.coreConnection.send({
      type: "confirmation_resolved",
      confirmationId,
      deviceId: outcome?.deviceId,
      capabilityName: outcome?.capabilityName,
      success: outcome?.result.success ?? false,
      data: outcome?.result.data,
      error: outcome ? outcome.result.error : "Confirmación desconocida o ya expirada",
      at: new Date().toISOString(),
    });
  }
}
