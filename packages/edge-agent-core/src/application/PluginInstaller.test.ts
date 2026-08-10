import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@kan/plugin-contract";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { PluginPackageExtractorPort } from "../domain/ports/PluginPackageExtractorPort";
import type { FetchedPluginPackage, PluginPackageFetcherPort } from "../domain/ports/PluginPackageFetcherPort";
import type { ManagedProcess, ProcessLauncherPort, SpawnOptions } from "../domain/ports/ProcessLauncherPort";
import type { CreatedVenv, VenvManagerPort } from "../domain/ports/VenvManagerPort";
import { EdgeAgentBus } from "./EdgeAgentBus";
import { PluginInstaller } from "./PluginInstaller";
import { PluginManager } from "./PluginManager";

function createInMemoryConfigStore(): ConfigStorePort {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      data.set(key, value);
    },
    all: () => Object.fromEntries(data),
  };
}

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const VALID_MANIFEST: PluginManifest = {
  id: "kan-plugin-vision-py",
  version: "0.1.0",
  displayName: "Visión artificial (OpenCV)",
  kind: "device-driver",
  runtime: "python-sidecar",
  permissions: { devices: ["camera-usb"], network: false, filesystem: [] },
};

class FakeFetcher implements PluginPackageFetcherPort {
  readonly calls: string[] = [];
  constructor(
    private readonly manifest: unknown = VALID_MANIFEST,
    private readonly archive: Buffer = Buffer.from("contenido-fake-del-tar-gz"),
  ) {}

  async fetch(pluginId: string): Promise<FetchedPluginPackage> {
    this.calls.push(pluginId);
    return { manifest: this.manifest as PluginManifest, archive: this.archive };
  }
}

class FakeExtractor implements PluginPackageExtractorPort {
  readonly calls: Array<{ archive: Buffer; destDir: string }> = [];
  async extract(archive: Buffer, destDir: string): Promise<void> {
    this.calls.push({ archive, destDir });
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "requirements.txt"), "kan-plugin-sdk-py\n");
  }
}

class FakeVenvManager implements VenvManagerPort {
  readonly createCalls: string[] = [];
  readonly installCalls: Array<{ pythonExecutablePath: string; requirementsPath: string }> = [];
  constructor(private readonly failOnCreate = false) {}

  async create(pluginDir: string): Promise<CreatedVenv> {
    this.createCalls.push(pluginDir);
    if (this.failOnCreate) throw new Error("no se pudo crear el venv (simulado)");
    return { pythonExecutablePath: join(pluginDir, "fake-python") };
  }

  async install(pythonExecutablePath: string, requirementsPath: string): Promise<void> {
    this.installCalls.push({ pythonExecutablePath, requirementsPath });
  }
}

/** Nunca debería invocarse en estos tests — el plugin queda pendiente de aprobación (P8), `onLoad()` no se llama. */
class NeverSpawnProcessLauncher implements ProcessLauncherPort {
  spawn(_command: string, _args: string[], _options: SpawnOptions): ManagedProcess {
    throw new Error("no debería spawnearse ningún proceso: el plugin queda pendiente de aprobación de permisos");
  }
}

describe("PluginInstaller", () => {
  let pluginsDir: string;

  beforeEach(async () => {
    pluginsDir = await mkdtemp(join(tmpdir(), "kan-plugin-installer-test-"));
  });

  afterEach(async () => {
    await rm(pluginsDir, { recursive: true, force: true });
  });

  function setup(overrides: { fetcher?: FakeFetcher; venvManager?: FakeVenvManager } = {}) {
    const bus = new EdgeAgentBus();
    const configStore = createInMemoryConfigStore();
    const pluginManager = new PluginManager(bus, createLogger(), configStore);
    const fetcher = overrides.fetcher ?? new FakeFetcher();
    const extractor = new FakeExtractor();
    const venvManager = overrides.venvManager ?? new FakeVenvManager();
    const installer = new PluginInstaller({
      pluginManager,
      bus,
      logger: createLogger(),
      configStore,
      fetcher,
      extractor,
      venvManager,
      processLauncher: new NeverSpawnProcessLauncher(),
      pluginsDir,
    });
    return { bus, configStore, pluginManager, fetcher, extractor, venvManager, installer };
  }

  it("install() completo: fetch -> valida -> extrae -> venv -> registra, y emite progreso en orden", async () => {
    const { bus, pluginManager, fetcher, extractor, venvManager, installer } = setup();
    const progressSteps: string[] = [];
    bus.on("plugin.install_progress", ({ step }) => progressSteps.push(step));
    const installed = vi.fn();
    bus.on("plugin.installed", installed);

    const result = await installer.install("kan-plugin-vision-py");

    expect(progressSteps).toEqual(["fetching", "extracting", "creating_venv", "installing_dependencies"]);
    expect(fetcher.calls).toEqual(["kan-plugin-vision-py"]);
    expect(extractor.calls).toHaveLength(1);
    expect(venvManager.createCalls).toHaveLength(1);
    expect(venvManager.installCalls).toEqual([
      {
        pythonExecutablePath: join(result.installDir, "fake-python"),
        requirementsPath: join(result.installDir, "requirements.txt"),
      },
    ]);
    expect(installed).toHaveBeenCalledWith({ pluginId: "kan-plugin-vision-py" });

    expect(result.pluginId).toBe("kan-plugin-vision-py");
    expect(result.installDir).toBe(join(pluginsDir, "kan-plugin-vision-py", "0.1.0"));
    expect(installer.listInstalled()).toEqual([result]);

    // register() real: sin permisos pre-otorgados, queda pendiente de aprobación — no se llama onLoad().
    expect(pluginManager.list().map((i) => i.manifest.id)).toEqual(["kan-plugin-vision-py"]);
    expect(pluginManager.listPendingPermissions()).toHaveLength(1);
  });

  it("install() rechaza un manifest inválido antes de extraer nada, y emite install_failed", async () => {
    const { extractor, venvManager, installer } = setup({
      fetcher: new FakeFetcher({ id: "kan-plugin-x" } /* le faltan campos requeridos */),
    });

    await expect(installer.install("kan-plugin-x")).rejects.toThrow(/Manifest inválido/);
    expect(extractor.calls).toHaveLength(0);
    expect(venvManager.createCalls).toHaveLength(0);
  });

  it("install() rechaza un manifest con runtime distinto de python-sidecar", async () => {
    const { extractor, installer } = setup({
      fetcher: new FakeFetcher({ ...VALID_MANIFEST, runtime: "in-process-ts" }),
    });

    await expect(installer.install("kan-plugin-vision-py")).rejects.toThrow(/no "python-sidecar"/);
    expect(extractor.calls).toHaveLength(0);
  });

  it("install() borra el directorio si falla la creación del venv, y emite install_failed", async () => {
    const { bus, installer } = setup({ venvManager: new FakeVenvManager(true) });
    const failed = vi.fn();
    bus.on("plugin.install_failed", failed);
    const expectedInstallDir = join(pluginsDir, "kan-plugin-vision-py", "0.1.0");

    await expect(installer.install("kan-plugin-vision-py")).rejects.toThrow(/no se pudo crear el venv/);

    expect(failed).toHaveBeenCalledWith({ pluginId: "kan-plugin-vision-py", error: expect.stringContaining("venv") });
    await expect(rm(expectedInstallDir, { recursive: true })).rejects.toThrow(); // ya no existe
  });

  it("uninstall() deshabilita el plugin, borra el directorio, y lo saca del registro", async () => {
    const { bus, installer } = setup();
    const installed = await installer.install("kan-plugin-vision-py");
    const uninstalled = vi.fn();
    bus.on("plugin.uninstalled", uninstalled);

    await installer.uninstall("kan-plugin-vision-py");

    expect(installer.listInstalled()).toEqual([]);
    expect(uninstalled).toHaveBeenCalledWith({ pluginId: "kan-plugin-vision-py" });
    await expect(rm(installed.installDir, { recursive: true })).rejects.toThrow(); // ya no existe
  });

  it("restoreInstalled() vuelve a registrar cada plugin instalado sin descargar nada de nuevo", async () => {
    const { configStore, fetcher, installer } = setup();
    await installer.install("kan-plugin-vision-py");
    expect(fetcher.calls).toHaveLength(1);

    // "Reinicio del Edge Agent": nuevo PluginManager/PluginInstaller sobre el mismo configStore.
    const bus2 = new EdgeAgentBus();
    const pluginManager2 = new PluginManager(bus2, createLogger(), configStore);
    const installer2 = new PluginInstaller({
      pluginManager: pluginManager2,
      bus: bus2,
      logger: createLogger(),
      configStore,
      fetcher,
      extractor: new FakeExtractor(),
      venvManager: new FakeVenvManager(),
      processLauncher: new NeverSpawnProcessLauncher(),
      pluginsDir,
    });

    await installer2.restoreInstalled();

    expect(fetcher.calls).toHaveLength(1); // sigue en 1: restoreInstalled() no descarga nada
    expect(pluginManager2.list().map((i) => i.manifest.id)).toEqual(["kan-plugin-vision-py"]);
  });
});
