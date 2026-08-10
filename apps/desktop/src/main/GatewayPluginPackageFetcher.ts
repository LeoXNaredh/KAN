import type { PluginManifest } from "@kan/plugin-contract";
import type { ConfigStorePort, FetchedPluginPackage, PluginPackageFetcherPort } from "@kan/edge-agent-core";

export interface PluginCatalogEntryDTO {
  manifest: PluginManifest;
  description?: string;
}

/**
 * Implementación real de `PluginPackageFetcherPort` contra el Gateway
 * (ADR-056, Fase 5) — mismo patrón de auth exacto que `pairAgent()`/
 * `syncPluginConfig()` en `apps/main/index.ts`: header `X-Pairing-Secret`/
 * `X-Edge-Agent-Id`, nunca el token interno (este proceso nunca lo tiene).
 * `listCatalog()` es un método extra, fuera del Port — la Fase 3 no
 * necesitaba listar el catálogo (`PluginInstaller` solo instala por id),
 * pero la UI (esta fase) sí necesita mostrar qué hay disponible.
 */
export class GatewayPluginPackageFetcher implements PluginPackageFetcherPort {
  constructor(
    private readonly configStore: ConfigStorePort,
    private readonly edgeAgentId: string,
    private readonly gatewayHttpUrl: string = process.env.KAN_GATEWAY_HTTP_URL ?? "http://localhost:8787",
  ) {}

  async listCatalog(): Promise<PluginCatalogEntryDTO[]> {
    const pairingToken = this.requirePairingToken();
    const response = await fetch(`${this.gatewayHttpUrl}/v1/plugins/catalog`, {
      headers: { "X-Pairing-Secret": pairingToken, "X-Edge-Agent-Id": this.edgeAgentId },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; catalog?: PluginCatalogEntryDTO[] };
    if (!response.ok) throw new Error(body.error ?? "No se pudo obtener el catálogo de plugins.");
    return body.catalog ?? [];
  }

  async fetch(pluginId: string): Promise<FetchedPluginPackage> {
    const pairingToken = this.requirePairingToken();
    const downloadResponse = await fetch(`${this.gatewayHttpUrl}/v1/plugins/${encodeURIComponent(pluginId)}/download`, {
      method: "POST",
      headers: { "X-Pairing-Secret": pairingToken, "X-Edge-Agent-Id": this.edgeAgentId },
    });
    const downloadBody = (await downloadResponse.json().catch(() => ({}))) as {
      error?: string;
      downloadUrl?: string;
      manifest?: PluginManifest;
    };
    if (!downloadResponse.ok || !downloadBody.downloadUrl || !downloadBody.manifest) {
      throw new Error(downloadBody.error ?? "No se pudo iniciar la descarga del plugin.");
    }

    // La signed URL de Supabase Storage es autocontenida — sin headers propios.
    const archiveResponse = await fetch(downloadBody.downloadUrl);
    if (!archiveResponse.ok) throw new Error("No se pudo descargar el paquete del plugin.");
    const archive = Buffer.from(await archiveResponse.arrayBuffer());

    return { manifest: downloadBody.manifest, archive };
  }

  private requirePairingToken(): string {
    const pairingToken = this.configStore.get<string>("pairingToken");
    if (!pairingToken) throw new Error("Todavía no vinculaste este Edge Agent con tu cuenta.");
    return pairingToken;
  }
}
