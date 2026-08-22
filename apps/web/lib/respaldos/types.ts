import type { ProjectBackupType } from "@kan/plugin-contract";

/** Mismo shape que DeviceSnapshotRecord (@kan/gateway-core) — pass-through BFF, igual criterio que CapabilityView en lib/secuencias/types.ts. */
export interface DeviceSnapshotView {
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

export interface SnapshotFileEntry {
  path: string;
  content: string;
}

/** Contenido de un snapshot 'source' (GET /v1/snapshots/:id/content). */
export interface SourceSnapshotContent {
  files: SnapshotFileEntry[];
}

/** Mismo shape que AlertRule (@kan/gateway-core) — solo los campos que la UI necesita mostrar, nunca el objeto completo crudo. */
export interface ConfigSnapshotAlertRule {
  id: string;
  capabilityRef: string;
  comparator: "above" | "below";
  threshold: number;
  label: string;
  unit?: string;
}

/** Contenido de un snapshot 'config' (GET /v1/snapshots/:id/content). */
export interface ConfigSnapshotContent {
  deviceId: string;
  deviceKind: string;
  generatedAt: string;
  alertRules: ConfigSnapshotAlertRule[];
}

/**
 * `deviceKind` conocidos que solo soportan backup de tipo "config" (docs/06,
 * Plataforma C) — no tienen ninguna capability `project_*` real (PLC/Modbus/
 * OPC-UA no exponen ningún programa legible), así que la UI no puede
 * detectarlos por capability como a MicroPython/Arduino. Tabla estática a
 * propósito (estos plugins nunca implementan `ProjectDriverPort`, ver
 * packages/gateway-core `deviceConfigSnapshot.ts`).
 */
export const CONFIG_ONLY_DEVICE_KINDS = new Set(["modbus", "opcua"]);

export function isConfigOnlyDeviceKind(deviceKind: string): boolean {
  return CONFIG_ONLY_DEVICE_KINDS.has(deviceKind);
}

export const BACKUP_TYPE_LABEL: Record<ProjectBackupType, string> = {
  source: "Código fuente",
  binary: "Binario compilado",
  config: "Configuración KAN",
};
