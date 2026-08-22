import type { ConfigStorePort } from "@kan/edge-agent-core";
import type { DownloadedSnapshot, ProjectBackupType, SnapshotTransportPort, UploadedSnapshot, UploadSnapshotInput } from "@kan/plugin-contract";

function isProjectBackupType(value: unknown): value is ProjectBackupType {
  return value === "source" || value === "binary" || value === "config";
}

/**
 * Implementación real de `SnapshotTransportPort` contra el Gateway (docs/06,
 * backup/restore de proyecto) — mismo patrón exacto de auth que
 * `GatewayPluginPackageFetcher`: header `X-Pairing-Secret`/`X-Edge-Agent-Id`,
 * nunca el token interno (este proceso nunca lo tiene). Es la dirección
 * contraria a esa clase (acá el Edge Agent es quien produce el artefacto),
 * así que en vez de una descarga simple hay un PUT a la signed *upload* URL
 * de Supabase Storage que da `createSignedUploadUrl()` — mismo contrato que
 * usa `uploadToSignedUrl()` de `@supabase/storage-js` por debajo, sin traer
 * esa dependencia acá (el Edge Agent nunca tiene credenciales de Supabase).
 */
export class GatewaySnapshotTransport implements SnapshotTransportPort {
  constructor(
    private readonly configStore: ConfigStorePort,
    private readonly edgeAgentId: string,
    private readonly gatewayHttpUrl: string = process.env.KAN_GATEWAY_HTTP_URL ?? "http://localhost:8787",
  ) {}

  async upload(input: UploadSnapshotInput): Promise<UploadedSnapshot> {
    const pairingToken = this.requirePairingToken();
    const headers = { "X-Pairing-Secret": pairingToken, "X-Edge-Agent-Id": this.edgeAgentId, "Content-Type": "application/json" };

    const urlResponse = await fetch(`${this.gatewayHttpUrl}/v1/devices/${encodeURIComponent(input.deviceId)}/snapshots/upload-url`, {
      method: "POST",
      headers,
      body: JSON.stringify({ backupType: input.backupType }),
    });
    const urlBody = (await urlResponse.json().catch(() => ({}))) as {
      error?: string;
      signedUrl?: string;
      token?: string;
      storageObjectPath?: string;
    };
    if (!urlResponse.ok || !urlBody.signedUrl || !urlBody.storageObjectPath) {
      throw new Error(urlBody.error ?? "No se pudo iniciar la subida del snapshot.");
    }

    const uploadResponse = await fetch(urlBody.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" },
      body: input.content,
    });
    if (!uploadResponse.ok) throw new Error("No se pudo subir el snapshot a Supabase Storage.");

    const confirmResponse = await fetch(`${this.gatewayHttpUrl}/v1/devices/${encodeURIComponent(input.deviceId)}/snapshots/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storageObjectPath: urlBody.storageObjectPath,
        backupType: input.backupType,
        deviceKind: input.deviceKind,
        label: input.label,
        sizeBytes: input.content.byteLength,
      }),
    });
    const confirmBody = (await confirmResponse.json().catch(() => ({}))) as { error?: string; snapshot?: { id: string } };
    if (!confirmResponse.ok || !confirmBody.snapshot) {
      throw new Error(confirmBody.error ?? "No se pudo confirmar el snapshot subido.");
    }

    return { snapshotId: confirmBody.snapshot.id };
  }

  async download(deviceId: string, snapshotId: string): Promise<DownloadedSnapshot> {
    const pairingToken = this.requirePairingToken();
    const urlResponse = await fetch(
      `${this.gatewayHttpUrl}/v1/devices/${encodeURIComponent(deviceId)}/snapshots/${encodeURIComponent(snapshotId)}/download-url`,
      { headers: { "X-Pairing-Secret": pairingToken, "X-Edge-Agent-Id": this.edgeAgentId } },
    );
    const urlBody = (await urlResponse.json().catch(() => ({}))) as {
      error?: string;
      downloadUrl?: string;
      backupType?: unknown;
    };
    if (!urlResponse.ok || !urlBody.downloadUrl || !isProjectBackupType(urlBody.backupType)) {
      throw new Error(urlBody.error ?? "No se pudo iniciar la descarga del snapshot.");
    }

    // La signed URL de Supabase Storage es autocontenida — sin headers propios.
    const contentResponse = await fetch(urlBody.downloadUrl);
    if (!contentResponse.ok) throw new Error("No se pudo descargar el snapshot.");
    return { content: Buffer.from(await contentResponse.arrayBuffer()), backupType: urlBody.backupType };
  }

  private requirePairingToken(): string {
    const pairingToken = this.configStore.get<string>("pairingToken");
    if (!pairingToken) throw new Error("Todavía no vinculaste este Edge Agent con tu cuenta.");
    return pairingToken;
  }
}
