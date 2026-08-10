import type { PluginManifest } from "@kan/plugin-contract";

export interface FetchedPluginPackage {
  manifest: PluginManifest;
  /** Contenido crudo del `.tar.gz` — `PluginInstaller` lo pasa tal cual a `PluginPackageExtractorPort`. */
  archive: Buffer;
}

/**
 * Descarga un paquete de plugin sidecar desde el catálogo (ADR-056).
 * Implementación real recién en Fase 5 (`GatewayPluginPackageFetcher`,
 * `apps/desktop`) — `PluginInstaller`/Fase 3 se prueba entera contra un
 * fake de este puerto, sin depender de que exista el Gateway todavía.
 */
export interface PluginPackageFetcherPort {
  fetch(pluginId: string): Promise<FetchedPluginPackage>;
}
