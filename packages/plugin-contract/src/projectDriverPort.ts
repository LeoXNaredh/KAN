export interface ProjectFileEntry {
  path: string;
  sizeBytes?: number;
}

export type ProjectBackupType = "source" | "binary" | "config";

/**
 * Contrato opcional que un `DeviceDriverPort` puede implementar además del
 * suyo propio (docs/06, backup/restore de proyectos) para exponer
 * backup/restore de "lo que corre en el dispositivo". Separado de
 * `DeviceDriverPort` a propósito: la mayoría de los drivers (Modbus, OPC-UA,
 * simulador) no tienen nada legible para respaldar — para esos, el snapshot
 * es de tipo "config" y lo arma el Gateway desde su propia configuración
 * (reglas de alerta, secuencias), sin pasar por acá en absoluto.
 *
 * `listFiles`/`readFile`/`writeFile` son las únicas primitivas que un driver
 * necesita implementar — `@kan/plugin-sdk-ts` (`createProjectCapabilities`/
 * `handleProjectCapability`) arma `project_save_snapshot`/
 * `project_restore_snapshot` recorriéndolas, así ningún plugin reimplementa
 * el bundling.
 */
export interface ProjectDriverPort {
  getBackupType(): ProjectBackupType;
  listFiles(deviceId: string): Promise<ProjectFileEntry[]>;
  readFile(deviceId: string, path: string): Promise<string>;
  writeFile(deviceId: string, path: string, content: string): Promise<void>;
  /** Solo para `getBackupType() === "binary"` — un dump de flash único, no un árbol de archivos. */
  readBinaryImage?(deviceId: string): Promise<Buffer>;
  writeBinaryImage?(deviceId: string, image: Buffer): Promise<void>;
}

export interface UploadSnapshotInput {
  deviceId: string;
  deviceKind: string;
  backupType: ProjectBackupType;
  label?: string;
  content: Buffer;
}

export interface UploadedSnapshot {
  snapshotId: string;
}

export interface DownloadedSnapshot {
  content: Buffer;
  /**
   * El `backupType` con el que ese snapshot se guardó — no necesariamente el
   * default actual de `driver.getBackupType()`: un mismo dispositivo (ej.
   * Arduino) puede tener snapshots `source` y `binary` mezclados a lo largo
   * del tiempo (`project_save_snapshot` acepta un `backupType` explícito por
   * llamada). El restore SIEMPRE debe confiar en este valor, nunca en
   * `driver.getBackupType()`, para no reinterpretar mal un snapshot viejo.
   */
  backupType: ProjectBackupType;
}

/**
 * Sube/baja el contenido de un snapshot al backend — implementado por la
 * infra del Edge Agent (`GatewaySnapshotTransport`, `apps/desktop`, vía
 * signed URL de Supabase Storage que le da el Gateway) e inyectado por
 * constructor a cada plugin con `ProjectDriverPort`, mismo criterio que
 * `SerialTransportPort` en `Esp32ArduinoPlugin`. Vive acá (no en
 * `edge-agent-core`) porque lo consume `@kan/plugin-sdk-ts`
 * (`handleProjectCapability`), que no depende de `edge-agent-core` — es al
 * revés (`edge-agent-core` depende de `plugin-sdk-ts`).
 */
export interface SnapshotTransportPort {
  upload(input: UploadSnapshotInput): Promise<UploadedSnapshot>;
  download(deviceId: string, snapshotId: string): Promise<DownloadedSnapshot>;
}
