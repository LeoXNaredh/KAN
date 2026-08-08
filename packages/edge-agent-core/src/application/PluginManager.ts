import type { PluginPermissions } from "@kan/plugin-contract";
import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { PluginInstance } from "../domain/entities/PluginInstance";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "./EdgeAgentBus";
import { PluginPermissionStore } from "./PluginPermissionStore";

const ENABLED_PLUGINS_KEY = "enabledPluginIds";

function permissionsEqual(a: PluginPermissions, b: PluginPermissions): boolean {
  return (
    a.network === b.network &&
    JSON.stringify([...a.devices].sort()) === JSON.stringify([...b.devices].sort()) &&
    JSON.stringify([...a.filesystem].sort()) === JSON.stringify([...b.filesystem].sort())
  );
}

/**
 * Carga/habilita/deshabilita plugins de tipo driver de dispositivo
 * (requisito 3). Independiente del Core: no necesita conectividad para
 * operar, solo la config local (requisito 12) y el bus interno (requisito 7).
 *
 * Gate de permisos deny-by-default (P8, ADR-041, ADR-008): `register()` ya
 * no habilita un plugin de una. Si sus `manifest.permissions` no coinciden
 * con lo que el usuario ya aprobó antes (`PluginPermissionStore` — nunca,
 * o una versión anterior con permisos distintos), la instancia queda en
 * `"loaded"` (estado ya existente en `PluginInstanceStatus`, sin usar hasta
 * este incremento) hasta que `approve()`/`reject()` resuelvan.
 */
export class PluginManager {
  private readonly instances = new Map<string, PluginInstance>();
  private readonly permissionStore: PluginPermissionStore;

  constructor(
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
    private readonly configStore: ConfigStorePort,
  ) {
    this.permissionStore = new PluginPermissionStore(configStore);
  }

  async register(driver: KanDeviceDriverPlugin): Promise<PluginInstance> {
    try {
      const granted = this.permissionStore.get(driver.id);
      const alreadyApproved = granted !== undefined && permissionsEqual(granted, driver.manifest.permissions);

      if (!alreadyApproved) {
        const instance: PluginInstance = { manifest: driver.manifest, status: "loaded", driver };
        this.instances.set(driver.id, instance);
        this.logger.info(`Plugin registrado, pendiente de aprobación de permisos: ${driver.id}`);
        this.bus.emit("plugin.loaded", { pluginId: driver.id });
        this.bus.emit("plugin.permission_pending", {
          pluginId: driver.id,
          displayName: driver.manifest.displayName,
          permissions: driver.manifest.permissions,
        });
        return instance;
      }

      await driver.onLoad();
      const instance: PluginInstance = { manifest: driver.manifest, status: "enabled", driver };
      this.instances.set(driver.id, instance);
      this.persistEnabledState(driver.id, true);
      this.logger.info(`Plugin cargado: ${driver.id}`);
      this.bus.emit("plugin.loaded", { pluginId: driver.id });
      return instance;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error cargando plugin ${driver.id}: ${message}`);
      this.bus.emit("plugin.error", { pluginId: driver.id, error: message });
      throw error;
    }
  }

  /** Aprueba los permisos pendientes de un plugin y lo habilita. */
  async approve(pluginId: string): Promise<KanDeviceDriverPlugin | undefined> {
    const instance = this.instances.get(pluginId);
    if (!instance || instance.status !== "loaded") return undefined;

    await instance.driver.onLoad();
    instance.status = "enabled";
    this.persistEnabledState(pluginId, true);
    this.permissionStore.grant(pluginId, instance.driver.manifest.permissions);
    this.logger.info(`Permisos aprobados, plugin habilitado: ${pluginId}`);
    this.bus.emit("plugin.permission_resolved", { pluginId, approved: true });
    return instance.driver;
  }

  /** Rechaza los permisos pendientes de un plugin — nunca se habilita, `onLoad()` nunca se llama. */
  reject(pluginId: string): void {
    const instance = this.instances.get(pluginId);
    if (!instance || instance.status !== "loaded") return;

    instance.status = "disabled";
    this.logger.info(`Permisos rechazados, plugin deshabilitado: ${pluginId}`);
    this.bus.emit("plugin.permission_resolved", { pluginId, approved: false });
  }

  listPendingPermissions(): PluginInstance[] {
    return this.list().filter((instance) => instance.status === "loaded");
  }

  async disable(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) return;
    await instance.driver.onUnload();
    instance.status = "disabled";
    this.persistEnabledState(pluginId, false);
    this.logger.info(`Plugin deshabilitado: ${pluginId}`);
  }

  list(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  getEnabledDrivers(): KanDeviceDriverPlugin[] {
    return this.list()
      .filter((instance) => instance.status === "enabled")
      .map((instance) => instance.driver);
  }

  private persistEnabledState(pluginId: string, enabled: boolean): void {
    const enabledIds = new Set(this.configStore.get<string[]>(ENABLED_PLUGINS_KEY) ?? []);
    if (enabled) {
      enabledIds.add(pluginId);
    } else {
      enabledIds.delete(pluginId);
    }
    this.configStore.set(ENABLED_PLUGINS_KEY, Array.from(enabledIds));
  }
}
