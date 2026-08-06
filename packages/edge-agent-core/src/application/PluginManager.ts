import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { PluginInstance } from "../domain/entities/PluginInstance";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "./EdgeAgentBus";

const ENABLED_PLUGINS_KEY = "enabledPluginIds";

/**
 * Carga/habilita/deshabilita plugins de tipo driver de dispositivo
 * (requisito 3). Independiente del Core: no necesita conectividad para
 * operar, solo la config local (requisito 12) y el bus interno (requisito 7).
 */
export class PluginManager {
  private readonly instances = new Map<string, PluginInstance>();

  constructor(
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
    private readonly configStore: ConfigStorePort,
  ) {}

  async register(driver: KanDeviceDriverPlugin): Promise<PluginInstance> {
    try {
      await driver.onLoad();
      const instance: PluginInstance = {
        manifest: driver.manifest,
        status: "enabled",
        driver,
      };
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
