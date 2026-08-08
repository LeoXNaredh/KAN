import type { PluginPermissions } from "@kan/plugin-contract";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";

const STORE_KEY = "grantedPluginPermissions";

/**
 * Persiste qué permisos ya aprobó el usuario para cada plugin (P8, ADR-041)
 * — mismo patrón que `SafetyPolicyStore`: envuelve `ConfigStorePort` bajo
 * una clave dedicada. `PluginManager` la usa para decidir si un plugin
 * puede habilitarse directo (permisos ya otorgados y sin cambios) o si
 * necesita quedar pendiente de aprobación.
 */
export class PluginPermissionStore {
  constructor(private readonly configStore: ConfigStorePort) {}

  get(pluginId: string): PluginPermissions | undefined {
    return this.readAll()[pluginId];
  }

  grant(pluginId: string, permissions: PluginPermissions): void {
    const all = this.readAll();
    all[pluginId] = permissions;
    this.configStore.set(STORE_KEY, all);
  }

  private readAll(): Record<string, PluginPermissions> {
    return this.configStore.get<Record<string, PluginPermissions>>(STORE_KEY) ?? {};
  }
}
