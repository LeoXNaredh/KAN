import type {
  CapabilityDescriptor,
  CapabilityResult,
  ProjectBackupType,
  ProjectDriverPort,
  SnapshotTransportPort,
} from "@kan/plugin-contract";
import { defineCapability } from "./defineCapability";

export const PROJECT_LIST_FILES = "project_list_files";
export const PROJECT_READ_FILE = "project_read_file";
export const PROJECT_SAVE_SNAPSHOT = "project_save_snapshot";
export const PROJECT_RESTORE_SNAPSHOT = "project_restore_snapshot";

interface SourceSnapshotBundle {
  files: Array<{ path: string; content: string }>;
}

/**
 * Las 4 capabilities estándar de backup/restore (docs/06) que cualquier
 * driver con `ProjectDriverPort` obtiene gratis, componiéndolas en su propio
 * `getCapabilities()` — mismo criterio que `defineCapability` (helper, no
 * magia): el plugin sigue siendo dueño de su lista de capabilities, esto
 * solo evita reescribir los 4 descriptors en cada uno.
 */
export function createProjectCapabilities(_driver: ProjectDriverPort): CapabilityDescriptor[] {
  return [
    defineCapability({
      name: PROJECT_LIST_FILES,
      description: "Lista los archivos de proyecto presentes en el dispositivo.",
      severity: "read-only",
      supportsDryRun: false,
      inputSchema: { type: "object", properties: {} },
    }),
    defineCapability({
      name: PROJECT_READ_FILE,
      description: "Lee el contenido de un archivo de proyecto del dispositivo.",
      severity: "read-only",
      supportsDryRun: false,
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    }),
    defineCapability({
      name: PROJECT_SAVE_SNAPSHOT,
      description:
        "Guarda un backup (snapshot) del proyecto actual del dispositivo. 'backupType' es opcional — por defecto usa el tipo propio del driver (ej. 'source' para código fuente); algunos drivers (ej. Arduino) soportan pedir explícitamente 'binary' para un dump de flash en vez de la fuente guardada.",
      severity: "read-only",
      supportsDryRun: false,
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string" },
          backupType: { type: "string", enum: ["source", "binary"] },
        },
      },
    }),
    defineCapability({
      name: PROJECT_RESTORE_SNAPSHOT,
      description: "Restaura un snapshot guardado, sobrescribiendo el proyecto actual del dispositivo.",
      severity: "irreversible-material",
      supportsDryRun: false,
      inputSchema: {
        type: "object",
        properties: { snapshotId: { type: "string" } },
        required: ["snapshotId"],
      },
    }),
  ];
}

function isProjectCapability(capabilityName: string): boolean {
  return (
    capabilityName === PROJECT_LIST_FILES ||
    capabilityName === PROJECT_READ_FILE ||
    capabilityName === PROJECT_SAVE_SNAPSHOT ||
    capabilityName === PROJECT_RESTORE_SNAPSHOT
  );
}

/**
 * Ejecuta una de las 4 capabilities de `createProjectCapabilities()`. El
 * plugin la llama desde su propio `invoke()` cuando `capabilityName` es una
 * de estas 4 — mismo patrón `switch`/delegación que ya usan los drivers
 * existentes para sus propias capabilities.
 */
export async function handleProjectCapability(
  driver: ProjectDriverPort,
  transport: SnapshotTransportPort,
  deviceId: string,
  deviceKind: string,
  capabilityName: string,
  input: unknown,
): Promise<CapabilityResult> {
  if (!isProjectCapability(capabilityName)) {
    return { success: false, error: `Capability desconocida: ${capabilityName}` };
  }

  try {
    switch (capabilityName) {
      case PROJECT_LIST_FILES: {
        const files = await driver.listFiles(deviceId);
        return { success: true, data: { files } };
      }

      case PROJECT_READ_FILE: {
        const path = (input as { path?: unknown } | null)?.path;
        if (typeof path !== "string" || path.length === 0) {
          return { success: false, error: "'path' debe ser un string no vacío" };
        }
        const content = await driver.readFile(deviceId, path);
        return { success: true, data: { path, content } };
      }

      case PROJECT_SAVE_SNAPSHOT: {
        const rawInput = input as { label?: unknown; backupType?: unknown } | null;
        const label = rawInput?.label;
        const requestedBackupType = rawInput?.backupType;
        // Un mismo driver puede soportar más de un `backupType` a la vez (ej.
        // Esp32ArduinoPlugin: 'source' del .ino guardado, o 'binary' de un
        // dump de flash) — el caller elige cuál quiere para ESTE snapshot;
        // sin pedido explícito, cae al default del driver.
        const backupType = isProjectBackupType(requestedBackupType) ? requestedBackupType : driver.getBackupType();
        const content = await buildSnapshotContent(driver, deviceId, backupType);
        const uploaded = await transport.upload({
          deviceId,
          deviceKind,
          backupType,
          label: typeof label === "string" ? label : undefined,
          content,
        });
        return { success: true, data: { snapshotId: uploaded.snapshotId, backupType } };
      }

      case PROJECT_RESTORE_SNAPSHOT: {
        const snapshotId = (input as { snapshotId?: unknown } | null)?.snapshotId;
        if (typeof snapshotId !== "string" || snapshotId.length === 0) {
          return { success: false, error: "'snapshotId' debe ser un string no vacío" };
        }
        const downloaded = await transport.download(deviceId, snapshotId);
        // Siempre el backupType con el que el snapshot se guardó en su
        // momento (ver `DownloadedSnapshot`), nunca `driver.getBackupType()`
        // — un driver que soporta más de un tipo (ver PROJECT_SAVE_SNAPSHOT)
        // puede tener snapshots viejos guardados con un tipo distinto al
        // default actual.
        await restoreSnapshotContent(driver, deviceId, downloaded.backupType, downloaded.content);
        return { success: true, data: { snapshotId, backupType: downloaded.backupType } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isProjectBackupType(value: unknown): value is ProjectBackupType {
  return value === "source" || value === "binary" || value === "config";
}

async function buildSnapshotContent(driver: ProjectDriverPort, deviceId: string, backupType: ProjectBackupType): Promise<Buffer> {
  if (backupType === "binary") {
    if (!driver.readBinaryImage) {
      throw new Error("Este driver no implementa readBinaryImage() para backups binarios");
    }
    return driver.readBinaryImage(deviceId);
  }

  const entries = await driver.listFiles(deviceId);
  const files = await Promise.all(
    entries.map(async (entry) => ({ path: entry.path, content: await driver.readFile(deviceId, entry.path) })),
  );
  const bundle: SourceSnapshotBundle = { files };
  return Buffer.from(JSON.stringify(bundle), "utf-8");
}

async function restoreSnapshotContent(driver: ProjectDriverPort, deviceId: string, backupType: ProjectBackupType, content: Buffer): Promise<void> {
  if (backupType === "binary") {
    if (!driver.writeBinaryImage) {
      throw new Error("Este driver no implementa writeBinaryImage() para restaurar backups binarios");
    }
    await driver.writeBinaryImage(deviceId, content);
    return;
  }

  const bundle = JSON.parse(content.toString("utf-8")) as SourceSnapshotBundle;
  for (const file of bundle.files) {
    await driver.writeFile(deviceId, file.path, file.content);
  }
}
