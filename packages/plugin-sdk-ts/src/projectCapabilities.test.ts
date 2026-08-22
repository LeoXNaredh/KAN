import { describe, expect, it } from "vitest";
import type { ProjectDriverPort, ProjectFileEntry, SnapshotTransportPort, UploadSnapshotInput } from "@kan/plugin-contract";
import {
  createProjectCapabilities,
  handleProjectCapability,
  PROJECT_LIST_FILES,
  PROJECT_READ_FILE,
  PROJECT_RESTORE_SNAPSHOT,
  PROJECT_SAVE_SNAPSHOT,
} from "./projectCapabilities";

const DEVICE_ID = "device-1";
const DEVICE_KIND = "micropython";

function makeSourceDriver(files: Record<string, string>): ProjectDriverPort {
  return {
    getBackupType: () => "source",
    listFiles: async (): Promise<ProjectFileEntry[]> => Object.keys(files).map((path) => ({ path })),
    readFile: async (_deviceId, path) => files[path],
    writeFile: async (_deviceId, path, content) => {
      files[path] = content;
    },
  };
}

function makeBinaryDriver(image: Buffer): ProjectDriverPort & { lastWrite?: Buffer } {
  const driver: ProjectDriverPort & { lastWrite?: Buffer } = {
    getBackupType: () => "binary",
    listFiles: async () => [],
    readFile: async () => "",
    writeFile: async () => {},
    readBinaryImage: async () => image,
    writeBinaryImage: async (_deviceId, received) => {
      driver.lastWrite = received;
    },
  };
  return driver;
}

/** Un driver que soporta ambos backupType a la vez (ej. Esp32ArduinoPlugin: 'source' del .ino guardado, 'binary' de un dump de flash), para probar el override explícito de PROJECT_SAVE_SNAPSHOT. */
function makeHybridDriver(files: Record<string, string>, image: Buffer): ProjectDriverPort & { lastWrite?: Buffer } {
  const driver: ProjectDriverPort & { lastWrite?: Buffer } = {
    getBackupType: () => "source",
    listFiles: async (): Promise<ProjectFileEntry[]> => Object.keys(files).map((path) => ({ path })),
    readFile: async (_deviceId, path) => files[path],
    writeFile: async (_deviceId, path, content) => {
      files[path] = content;
    },
    readBinaryImage: async () => image,
    writeBinaryImage: async (_deviceId, received) => {
      driver.lastWrite = received;
    },
  };
  return driver;
}

function makeFakeTransport(): SnapshotTransportPort & { uploads: UploadSnapshotInput[] } {
  const uploads: UploadSnapshotInput[] = [];
  const stored = new Map<string, { content: Buffer; backupType: UploadSnapshotInput["backupType"] }>();
  let nextId = 0;
  return {
    uploads,
    upload: async (input) => {
      uploads.push(input);
      const snapshotId = `snap-${nextId++}`;
      stored.set(snapshotId, { content: input.content, backupType: input.backupType });
      return { snapshotId };
    },
    download: async (_deviceId, snapshotId) => {
      const entry = stored.get(snapshotId);
      if (!entry) throw new Error(`Snapshot desconocido: ${snapshotId}`);
      return entry;
    },
  };
}

describe("createProjectCapabilities", () => {
  it("declara las 4 capabilities estándar con la severidad correcta", () => {
    const driver = makeSourceDriver({});
    const capabilities = createProjectCapabilities(driver);
    const byName = Object.fromEntries(capabilities.map((c) => [c.name, c]));

    expect(Object.keys(byName)).toEqual([
      PROJECT_LIST_FILES,
      PROJECT_READ_FILE,
      PROJECT_SAVE_SNAPSHOT,
      PROJECT_RESTORE_SNAPSHOT,
    ]);
    expect(byName[PROJECT_LIST_FILES].severity).toBe("read-only");
    expect(byName[PROJECT_READ_FILE].severity).toBe("read-only");
    expect(byName[PROJECT_SAVE_SNAPSHOT].severity).toBe("read-only");
    // Restaurar sobrescribe el dispositivo real — debe exigir confirmación.
    expect(byName[PROJECT_RESTORE_SNAPSHOT].severity).toBe("irreversible-material");
  });
});

describe("handleProjectCapability", () => {
  it("lista archivos", async () => {
    const driver = makeSourceDriver({ "main.py": "print(1)", "lib/util.py": "x = 1" });
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_LIST_FILES, {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ files: [{ path: "main.py" }, { path: "lib/util.py" }] });
  });

  it("lee un archivo", async () => {
    const driver = makeSourceDriver({ "main.py": "print(1)" });
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_READ_FILE, { path: "main.py" });
    expect(result).toEqual({ success: true, data: { path: "main.py", content: "print(1)" } });
  });

  it("rechaza project_read_file sin 'path'", async () => {
    const driver = makeSourceDriver({});
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_READ_FILE, {});
    expect(result.success).toBe(false);
  });

  it("arma y sube un bundle de código fuente en project_save_snapshot", async () => {
    const driver = makeSourceDriver({ "main.py": "print(1)", "lib/util.py": "x = 1" });
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, { label: "antes del cambio" });

    expect(result.success).toBe(true);
    expect(transport.uploads).toHaveLength(1);
    expect(transport.uploads[0]).toMatchObject({ deviceId: DEVICE_ID, backupType: "source", label: "antes del cambio" });
    const bundle = JSON.parse(transport.uploads[0].content.toString("utf-8"));
    expect(bundle.files).toEqual(
      expect.arrayContaining([
        { path: "main.py", content: "print(1)" },
        { path: "lib/util.py", content: "x = 1" },
      ]),
    );
  });

  it("descarga y reescribe los archivos en project_restore_snapshot", async () => {
    const driver = makeSourceDriver({ "main.py": "print(1)" });
    const transport = makeFakeTransport();
    const saveResult = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, {});
    const snapshotId = (saveResult.data as { snapshotId: string }).snapshotId;

    const restoredDriver = makeSourceDriver({ "main.py": "print(999) -- versión rota" });
    const result = await handleProjectCapability(restoredDriver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_RESTORE_SNAPSHOT, { snapshotId });

    expect(result.success).toBe(true);
    expect(await restoredDriver.readFile(DEVICE_ID, "main.py")).toBe("print(1)");
  });

  it("rechaza project_restore_snapshot sin 'snapshotId'", async () => {
    const driver = makeSourceDriver({});
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_RESTORE_SNAPSHOT, {});
    expect(result.success).toBe(false);
  });

  it("sube el dump binario tal cual para drivers 'binary'", async () => {
    const image = Buffer.from([1, 2, 3, 4]);
    const driver = makeBinaryDriver(image);
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, {});

    expect(result.success).toBe(true);
    expect(transport.uploads[0]).toMatchObject({ backupType: "binary" });
    expect(transport.uploads[0].content.equals(image)).toBe(true);
  });

  it("restaura un dump binario vía writeBinaryImage", async () => {
    const image = Buffer.from([9, 9, 9]);
    const driver = makeBinaryDriver(image);
    const transport = makeFakeTransport();
    const saveResult = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, {});
    const snapshotId = (saveResult.data as { snapshotId: string }).snapshotId;

    const restoreDriver = makeBinaryDriver(Buffer.alloc(0));
    const result = await handleProjectCapability(restoreDriver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_RESTORE_SNAPSHOT, { snapshotId });

    expect(result.success).toBe(true);
    expect(restoreDriver.lastWrite?.equals(image)).toBe(true);
  });

  it("PROJECT_SAVE_SNAPSHOT honra un 'backupType' explícito distinto del default del driver", async () => {
    const image = Buffer.from([7, 7, 7]);
    const driver = makeHybridDriver({ "sketch.ino": "void setup(){}" }, image);
    const transport = makeFakeTransport();

    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, { backupType: "binary" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ backupType: "binary" });
    expect(transport.uploads[0]).toMatchObject({ backupType: "binary" });
    expect(transport.uploads[0].content.equals(image)).toBe(true);
  });

  it("PROJECT_RESTORE_SNAPSHOT usa el backupType con el que se guardó el snapshot, no el default actual del driver", async () => {
    const image = Buffer.from([8, 8, 8]);
    const savingDriver = makeHybridDriver({}, image);
    const transport = makeFakeTransport();
    // Guardado explícitamente como 'binary', aunque el driver por defecto sea 'source'.
    const saveResult = await handleProjectCapability(savingDriver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, {
      backupType: "binary",
    });
    const snapshotId = (saveResult.data as { snapshotId: string }).snapshotId;

    const restoringDriver = makeHybridDriver({}, Buffer.alloc(0));
    const result = await handleProjectCapability(restoringDriver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_RESTORE_SNAPSHOT, {
      snapshotId,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ backupType: "binary" });
    // Si hubiera usado driver.getBackupType() ('source') en vez del tipo guardado, esto habría intentado JSON.parse() sobre bytes binarios y fallado.
    expect(restoringDriver.lastWrite?.equals(image)).toBe(true);
  });

  it("falla con error claro si el driver 'binary' no implementa readBinaryImage", async () => {
    const driver: ProjectDriverPort = {
      getBackupType: () => "binary",
      listFiles: async () => [],
      readFile: async () => "",
      writeFile: async () => {},
    };
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, PROJECT_SAVE_SNAPSHOT, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/readBinaryImage/);
  });

  it("rechaza un nombre de capability desconocido", async () => {
    const driver = makeSourceDriver({});
    const transport = makeFakeTransport();
    const result = await handleProjectCapability(driver, transport, DEVICE_ID, DEVICE_KIND, "not_a_project_capability", {});
    expect(result.success).toBe(false);
  });
});

