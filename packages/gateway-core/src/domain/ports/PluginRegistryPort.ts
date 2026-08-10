import type { PluginManifest } from "@kan/plugin-contract";

export interface PluginCatalogEntry {
  manifest: PluginManifest;
  description?: string;
}

export interface PluginDownloadRef {
  storageObjectPath: string;
  manifest: PluginManifest;
}

/**
 * Catálogo de plugins sidecar instalables bajo demanda (ADR-056, Fase 4).
 * Alcance de este incremento: solo paquetes oficiales de KAN, sin
 * publishers de terceros — "construye la cerradura" (descarga +
 * verificación estructural del manifest), no "abre la puerta" (sin
 * marketplace público, ver docs/09 Año 2). El Edge Agent nunca consulta
 * esto directo — siempre a través del Gateway (`GET /v1/plugins/catalog`),
 * mismo patrón que el resto de los datos de este proyecto.
 */
export interface PluginRegistryPort {
  listCatalog(): Promise<PluginCatalogEntry[]>;
  getDownloadRef(pluginId: string): Promise<PluginDownloadRef | undefined>;
  /** Signed URL de vida corta al paquete `.tar.gz` en Supabase Storage (bucket privado) — nunca una URL pública fija. */
  createSignedDownloadUrl(storageObjectPath: string, expiresInSeconds: number): Promise<string>;
}
