import type { ProjectBackupType } from "@kan/plugin-contract";

export interface DeviceSnapshotRecord {
  id: string;
  userId: string;
  edgeAgentId: string;
  deviceId: string;
  deviceName?: string;
  deviceKind: string;
  backupType: ProjectBackupType;
  label?: string;
  storageObjectPath: string;
  sizeBytes?: number;
  fileCount?: number;
  createdAt: string;
}

export interface NewDeviceSnapshotInput {
  userId: string;
  edgeAgentId: string;
  deviceId: string;
  deviceName?: string;
  deviceKind: string;
  backupType: ProjectBackupType;
  label?: string;
  storageObjectPath: string;
  sizeBytes?: number;
  fileCount?: number;
}

export interface SignedUploadTarget {
  signedUrl: string;
  token: string;
}

/**
 * Backups de código/configuración de dispositivo (docs/06, backup/restore
 * de proyectos) — mismo criterio que `PluginRegistryPort`: el Edge Agent
 * nunca consulta esto directo, siempre a través del Gateway
 * (`snapshotRoutes.ts` para mint de signed URL + confirmación, `routes.ts`
 * para listar/borrar autenticado por usuario). `createSignedUploadUrl()` y
 * `createSignedDownloadUrl()` viven acá (no como concepto de dominio) porque
 * son detalle de Supabase Storage — el bucket `device-snapshots` es
 * privado, nunca se sirve por URL pública fija.
 */
export interface DeviceSnapshotStorePort {
  create(input: NewDeviceSnapshotInput): Promise<DeviceSnapshotRecord>;
  listByUser(userId: string, deviceId?: string): Promise<DeviceSnapshotRecord[]>;
  get(id: string): Promise<DeviceSnapshotRecord | undefined>;
  delete(id: string): Promise<void>;
  createSignedUploadUrl(storageObjectPath: string): Promise<SignedUploadTarget>;
  createSignedDownloadUrl(storageObjectPath: string, expiresInSeconds: number): Promise<string>;
  /**
   * Sube/baja contenido directo, sin signed URL — para snapshots tipo
   * "config" (docs/06, Plataforma C: PLC/Modbus/OPC-UA), que arma y consume
   * el propio Gateway (nunca el Edge Agent, que solo tiene la signed URL de
   * un solo uso). El Gateway ya tiene `service_role`, así que no necesita
   * el intercambio de ticket que sí necesita el Edge Agent.
   */
  uploadContent(storageObjectPath: string, content: Buffer): Promise<void>;
  downloadContent(storageObjectPath: string): Promise<Buffer>;
}
