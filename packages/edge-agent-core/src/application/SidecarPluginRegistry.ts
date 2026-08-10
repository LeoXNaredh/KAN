import type { InstalledPlugin } from "../domain/entities/InstalledPlugin";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";

const STORE_KEY = "installedSidecarPlugins";

/**
 * Persiste qué plugins sidecar están instalados (ADR-056, Fase 3) — mismo
 * patrón que `PluginPermissionStore`/`SafetyPolicyStore`: envuelve
 * `ConfigStorePort` bajo una clave dedicada. `PluginInstaller` la usa para
 * reconstruir cada `SidecarProxyPlugin` en cada boot del Edge Agent sin
 * volver a descargar nada.
 */
export class SidecarPluginRegistry {
  constructor(private readonly configStore: ConfigStorePort) {}

  list(): InstalledPlugin[] {
    return Object.values(this.readAll());
  }

  get(pluginId: string): InstalledPlugin | undefined {
    return this.readAll()[pluginId];
  }

  save(installed: InstalledPlugin): void {
    const all = this.readAll();
    all[installed.pluginId] = installed;
    this.configStore.set(STORE_KEY, all);
  }

  remove(pluginId: string): void {
    const all = this.readAll();
    delete all[pluginId];
    this.configStore.set(STORE_KEY, all);
  }

  private readAll(): Record<string, InstalledPlugin> {
    return this.configStore.get<Record<string, InstalledPlugin>>(STORE_KEY) ?? {};
  }
}
