import type { PluginManifest } from "@kan/plugin-contract";

/**
 * Registro persistido de un plugin sidecar instalado (ADR-056, Fase 3).
 * `installDir` es donde vive el paquete extraído + su venv — necesario
 * para reconstruir el `SidecarProxyPlugin` en cada boot sin volver a
 * descargar nada, y para poder borrarlo entero al desinstalar.
 */
export interface InstalledPlugin {
  pluginId: string;
  version: string;
  manifest: PluginManifest;
  installDir: string;
  installedAt: string;
}
