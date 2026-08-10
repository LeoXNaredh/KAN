import type { SupabaseClient } from "@supabase/supabase-js";
import type { PluginKind, PluginManifest, PluginPermissions, PluginRuntime } from "@kan/plugin-contract";
import type { PluginCatalogEntry, PluginDownloadRef, PluginRegistryPort } from "@kan/gateway-core";

const BUCKET = "plugin-packages";

interface PluginRegistryRow {
  id: string;
  version: string;
  display_name: string;
  kind: PluginKind;
  runtime: PluginRuntime;
  permissions: PluginPermissions;
  description: string | null;
  storage_object_path: string;
}

function toManifest(row: PluginRegistryRow): PluginManifest {
  return {
    id: row.id,
    version: row.version,
    displayName: row.display_name,
    kind: row.kind,
    runtime: row.runtime,
    permissions: row.permissions,
  };
}

/**
 * Adaptador Supabase de `PluginRegistryPort` (ADR-056, Fase 4) — mismo
 * criterio que `SupabaseAuditStore`: recibe un cliente con la
 * `service_role key` (el Gateway no tiene sesión de usuario), `plugin_registry`
 * tiene RLS activo sin ninguna policy para anon/authenticated a propósito.
 * `createSignedDownloadUrl()` vive acá (no en el Port como concepto de
 * dominio) porque es un detalle de Supabase Storage — el bucket
 * `plugin-packages` es privado, nunca se sirve por URL pública fija.
 */
export class SupabasePluginRegistry implements PluginRegistryPort {
  constructor(private readonly client: SupabaseClient) {}

  async listCatalog(): Promise<PluginCatalogEntry[]> {
    const { data, error } = await this.client
      .from("plugin_registry")
      .select("id, version, display_name, kind, runtime, permissions, description, storage_object_path");
    if (error) throw new Error(error.message);

    return ((data ?? []) as PluginRegistryRow[]).map((row) => ({
      manifest: toManifest(row),
      description: row.description ?? undefined,
    }));
  }

  async getDownloadRef(pluginId: string): Promise<PluginDownloadRef | undefined> {
    const { data, error } = await this.client
      .from("plugin_registry")
      .select("id, version, display_name, kind, runtime, permissions, description, storage_object_path")
      .eq("id", pluginId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return undefined;

    const row = data as PluginRegistryRow;
    return { storageObjectPath: row.storage_object_path, manifest: toManifest(row) };
  }

  async createSignedDownloadUrl(storageObjectPath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(storageObjectPath, expiresInSeconds);
    if (error || !data) throw new Error(error?.message ?? "No se pudo generar la signed URL.");
    return data.signedUrl;
  }
}
