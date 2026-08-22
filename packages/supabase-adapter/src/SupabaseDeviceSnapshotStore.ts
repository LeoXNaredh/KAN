import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectBackupType } from "@kan/plugin-contract";
import type {
  DeviceSnapshotRecord,
  DeviceSnapshotStorePort,
  NewDeviceSnapshotInput,
  SignedUploadTarget,
} from "@kan/gateway-core";

const BUCKET = "device-snapshots";
const SELECT_COLUMNS =
  "id, user_id, edge_agent_id, device_id, device_name, device_kind, backup_type, label, storage_object_path, size_bytes, file_count, created_at";

interface DeviceSnapshotRow {
  id: string;
  user_id: string;
  edge_agent_id: string;
  device_id: string;
  device_name: string | null;
  device_kind: string;
  backup_type: ProjectBackupType;
  label: string | null;
  storage_object_path: string;
  size_bytes: number | null;
  file_count: number | null;
  created_at: string;
}

function toRecord(row: DeviceSnapshotRow): DeviceSnapshotRecord {
  return {
    id: row.id,
    userId: row.user_id,
    edgeAgentId: row.edge_agent_id,
    deviceId: row.device_id,
    deviceName: row.device_name ?? undefined,
    deviceKind: row.device_kind,
    backupType: row.backup_type,
    label: row.label ?? undefined,
    storageObjectPath: row.storage_object_path,
    sizeBytes: row.size_bytes ?? undefined,
    fileCount: row.file_count ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Adaptador Supabase de `DeviceSnapshotStorePort` — mismo criterio que
 * `SupabasePluginRegistry`: recibe un cliente con `service_role key`,
 * `device_snapshots` tiene RLS activo sin ninguna policy para
 * anon/authenticated a propósito (ADR-026). El bucket `device-snapshots` es
 * privado, nunca se sirve por URL pública fija.
 */
export class SupabaseDeviceSnapshotStore implements DeviceSnapshotStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: NewDeviceSnapshotInput): Promise<DeviceSnapshotRecord> {
    const { data, error } = await this.client
      .from("device_snapshots")
      .insert({
        user_id: input.userId,
        edge_agent_id: input.edgeAgentId,
        device_id: input.deviceId,
        device_name: input.deviceName ?? null,
        device_kind: input.deviceKind,
        backup_type: input.backupType,
        label: input.label ?? null,
        storage_object_path: input.storageObjectPath,
        size_bytes: input.sizeBytes ?? null,
        file_count: input.fileCount ?? null,
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return toRecord(data as DeviceSnapshotRow);
  }

  async listByUser(userId: string, deviceId?: string): Promise<DeviceSnapshotRecord[]> {
    let query = this.client.from("device_snapshots").select(SELECT_COLUMNS).eq("user_id", userId);
    if (deviceId) query = query.eq("device_id", deviceId);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as DeviceSnapshotRow[]).map(toRecord);
  }

  async get(id: string): Promise<DeviceSnapshotRecord | undefined> {
    const { data, error } = await this.client.from("device_snapshots").select(SELECT_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return undefined;
    return toRecord(data as DeviceSnapshotRow);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from("device_snapshots").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async createSignedUploadUrl(storageObjectPath: string): Promise<SignedUploadTarget> {
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUploadUrl(storageObjectPath);
    if (error || !data) throw new Error(error?.message ?? "No se pudo generar la signed upload URL.");
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async createSignedDownloadUrl(storageObjectPath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(storageObjectPath, expiresInSeconds);
    if (error || !data) throw new Error(error?.message ?? "No se pudo generar la signed URL.");
    return data.signedUrl;
  }

  async uploadContent(storageObjectPath: string, content: Buffer): Promise<void> {
    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(storageObjectPath, content, { contentType: "application/json", upsert: false });
    if (error) throw new Error(error.message);
  }

  async downloadContent(storageObjectPath: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(BUCKET).download(storageObjectPath);
    if (error || !data) throw new Error(error?.message ?? "No se pudo descargar el contenido.");
    return Buffer.from(await data.arrayBuffer());
  }
}
