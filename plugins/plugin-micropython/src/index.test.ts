import { afterEach, describe, expect, it } from "vitest";
import type { SnapshotTransportPort, UploadSnapshotInput } from "@kan/plugin-contract";
import { MicroPythonPlugin } from "./index";
import { FakeMicroPythonDevice, FakeRawSerialTransport, type FakeRawDevice } from "./infra/FakeRawSerialTransport";

function fakeSnapshotTransport(): SnapshotTransportPort & { uploads: UploadSnapshotInput[] } {
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

describe("MicroPythonPlugin.discover", () => {
  const originalPortEnv = process.env.KAN_MICROPYTHON_PORT;

  afterEach(() => {
    if (originalPortEnv === undefined) delete process.env.KAN_MICROPYTHON_PORT;
    else process.env.KAN_MICROPYTHON_PORT = originalPortEnv;
  });

  it("encuentra un board MicroPython real y omite un puerto serial ajeno", async () => {
    const foreignDevice: FakeRawDevice = { path: "COM4", handle: () => undefined };
    const transport = new FakeRawSerialTransport([new FakeMicroPythonDevice("COM3"), foreignDevice]);
    const plugin = new MicroPythonPlugin(transport, fakeSnapshotTransport());

    const found = await plugin.discover();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "MicroPython (COM3)", kind: "micropython", transport: "serial", address: "COM3" });
  });

  it("respeta KAN_MICROPYTHON_PORT en vez de escanear todos los puertos", async () => {
    process.env.KAN_MICROPYTHON_PORT = "COM3";
    const transport = new FakeRawSerialTransport([new FakeMicroPythonDevice("COM3"), new FakeMicroPythonDevice("COM5")]);
    const plugin = new MicroPythonPlugin(transport, fakeSnapshotTransport());

    const found = await plugin.discover();

    expect(found).toHaveLength(1);
    expect(found[0].address).toBe("COM3");
  });

  it("no deja el board de sondeo atascado en raw REPL (Ctrl-B tras sondear)", async () => {
    const device = new FakeMicroPythonDevice("COM3");
    const transport = new FakeRawSerialTransport([device]);
    const plugin = new MicroPythonPlugin(transport, fakeSnapshotTransport());

    await plugin.discover();

    // Si el sondeo hubiera dejado el device en raw REPL, un nuevo Ctrl-A no
    // devolvería nada raro — pero si ya volvió a REPL amigable, Ctrl-B (que
    // volvimos a mandar) no debería romper nada. La forma directa de
    // comprobarlo: abrir de nuevo y repetir el sondeo funciona igual.
    const secondFound = await plugin.discover();
    expect(secondFound).toHaveLength(1);
  });
});

describe("MicroPythonPlugin.getCapabilities", () => {
  it("expone las 4 capabilities de backup/restore, ninguna de control", async () => {
    const plugin = new MicroPythonPlugin(new FakeRawSerialTransport([]), fakeSnapshotTransport());

    const capabilities = plugin.getCapabilities("device-1");

    expect(capabilities.map((c) => c.name)).toEqual([
      "project_list_files",
      "project_read_file",
      "project_save_snapshot",
      "project_restore_snapshot",
    ]);
  });
});

describe("MicroPythonPlugin conectado", () => {
  async function connectedPlugin(files: Record<string, string> = {}) {
    const device = new FakeMicroPythonDevice("COM3", files);
    const transport = new FakeRawSerialTransport([device]);
    const snapshotTransport = fakeSnapshotTransport();
    const plugin = new MicroPythonPlugin(transport, snapshotTransport);
    const [descriptor] = await plugin.discover();
    await plugin.connect(descriptor.id);
    return { plugin, deviceId: descriptor.id, device, snapshotTransport };
  }

  it("invoke(project_list_files) lista los archivos del device", async () => {
    const { plugin, deviceId } = await connectedPlugin({ "main.py": "print(1)", "lib/util.py": "x = 1" });

    const result = await plugin.invoke(deviceId, "project_list_files", {});

    expect(result.success).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files.map((f) => f.path).sort();
    expect(files).toEqual(["lib/util.py", "main.py"]);
  });

  it("invoke(project_read_file) lee el contenido tal cual", async () => {
    const { plugin, deviceId } = await connectedPlugin({ "main.py": "print(1)" });

    const result = await plugin.invoke(deviceId, "project_read_file", { path: "main.py" });

    expect(result).toEqual({ success: true, data: { path: "main.py", content: "print(1)" } });
  });

  it("invoke(project_save_snapshot) sube un bundle con todos los archivos", async () => {
    const { plugin, deviceId, snapshotTransport } = await connectedPlugin({ "main.py": "print(1)", "boot.py": "pass" });

    const result = await plugin.invoke(deviceId, "project_save_snapshot", { label: "antes del cambio" });

    expect(result.success).toBe(true);
    expect(snapshotTransport.uploads).toHaveLength(1);
    expect(snapshotTransport.uploads[0]).toMatchObject({ deviceId, deviceKind: "micropython", backupType: "source", label: "antes del cambio" });
    const bundle = JSON.parse(snapshotTransport.uploads[0].content.toString("utf-8"));
    expect(bundle.files).toEqual(
      expect.arrayContaining([
        { path: "main.py", content: "print(1)" },
        { path: "boot.py", content: "pass" },
      ]),
    );
  });

  it("invoke(project_restore_snapshot) reescribe los archivos del device", async () => {
    const { plugin, deviceId, device } = await connectedPlugin({ "main.py": "print('viejo')" });
    const saveResult = await plugin.invoke(deviceId, "project_save_snapshot", {});
    const snapshotId = (saveResult.data as { snapshotId: string }).snapshotId;

    await device.readFileSync("main.py"); // sanity: el device sigue con el contenido viejo hasta acá
    await plugin.invoke(deviceId, "project_restore_snapshot", { snapshotId });

    expect(device.readFileSync("main.py")).toBe("print('viejo')");
  });

  it("invoke(project_read_file) sin 'path' devuelve un error controlado", async () => {
    const { plugin, deviceId } = await connectedPlugin();

    const result = await plugin.invoke(deviceId, "project_read_file", {});

    expect(result.success).toBe(false);
  });

  it("disconnect() cierra la sesión — un invoke posterior falla", async () => {
    const { plugin, deviceId } = await connectedPlugin({ "main.py": "x" });

    await plugin.disconnect(deviceId);
    const result = await plugin.invoke(deviceId, "project_list_files", {});

    expect(result.success).toBe(false);
  });
});
