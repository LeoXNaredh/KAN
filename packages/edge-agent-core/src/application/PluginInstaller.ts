import { rm } from "node:fs/promises";
import { join } from "node:path";
import { validatePluginManifest } from "@kan/plugin-contract";
import type { InstalledPlugin } from "../domain/entities/InstalledPlugin";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { PluginPackageExtractorPort } from "../domain/ports/PluginPackageExtractorPort";
import type { PluginPackageFetcherPort } from "../domain/ports/PluginPackageFetcherPort";
import type { ProcessLauncherPort } from "../domain/ports/ProcessLauncherPort";
import type { VenvManagerPort } from "../domain/ports/VenvManagerPort";
import { SidecarProxyPlugin } from "../infra/sidecar/SidecarProxyPlugin";
import type { EdgeAgentBus } from "./EdgeAgentBus";
import type { PluginManager } from "./PluginManager";
import { SidecarPluginRegistry } from "./SidecarPluginRegistry";

export interface PluginInstallerDeps {
  pluginManager: PluginManager;
  bus: EdgeAgentBus;
  logger: LoggerPort;
  configStore: ConfigStorePort;
  fetcher: PluginPackageFetcherPort;
  extractor: PluginPackageExtractorPort;
  venvManager: VenvManagerPort;
  processLauncher: ProcessLauncherPort;
  /** Directorio raíz donde viven todos los plugins sidecar instalados (ej. `userData/sidecar-plugins`, Fase 5). */
  pluginsDir: string;
}

/**
 * Orquesta instalación/desinstalación de plugins sidecar bajo demanda
 * (ADR-056, Fase 3): descarga → valida el manifest → extrae → crea venv →
 * instala dependencias → registra en `PluginManager` (mismo `register()`
 * que cualquier plugin in-process — el gate de permisos deny-by-default
 * se dispara igual). Cada paso emite `plugin.install_progress` para que
 * la UI (Fase 5) muestre progreso real, no un spinner ciego.
 */
export class PluginInstaller {
  private readonly registry: SidecarPluginRegistry;

  constructor(private readonly deps: PluginInstallerDeps) {
    this.registry = new SidecarPluginRegistry(deps.configStore);
  }

  listInstalled(): InstalledPlugin[] {
    return this.registry.list();
  }

  async install(pluginId: string): Promise<InstalledPlugin> {
    this.deps.bus.emit("plugin.install_progress", { pluginId, step: "fetching" });
    const { manifest: rawManifest, archive } = await this.deps.fetcher.fetch(pluginId);

    const validated = validatePluginManifest(rawManifest);
    if (!validated.ok) {
      this.deps.bus.emit("plugin.install_failed", { pluginId, error: validated.error });
      throw new Error(validated.error);
    }
    const manifest = validated.manifest;

    if (manifest.runtime !== "python-sidecar") {
      const error = `El paquete descargado para "${pluginId}" declara runtime "${manifest.runtime}", no "python-sidecar" — PluginInstaller solo instala sidecars (ADR-056; los plugins in-process-ts se registran a mano, ver apps/desktop).`;
      this.deps.bus.emit("plugin.install_failed", { pluginId, error });
      throw new Error(error);
    }

    const installDir = join(this.deps.pluginsDir, manifest.id, manifest.version);

    try {
      this.deps.bus.emit("plugin.install_progress", { pluginId, step: "extracting" });
      await this.deps.extractor.extract(archive, installDir);

      this.deps.bus.emit("plugin.install_progress", { pluginId, step: "creating_venv" });
      const { pythonExecutablePath } = await this.deps.venvManager.create(installDir);

      this.deps.bus.emit("plugin.install_progress", { pluginId, step: "installing_dependencies" });
      await this.deps.venvManager.install(pythonExecutablePath, join(installDir, "requirements.txt"));

      const installed: InstalledPlugin = {
        pluginId: manifest.id,
        version: manifest.version,
        manifest,
        installDir,
        installedAt: new Date().toISOString(),
      };
      this.registry.save(installed);

      await this.deps.pluginManager.register(new SidecarProxyPlugin(installed, this.deps.processLauncher));

      this.deps.bus.emit("plugin.installed", { pluginId: manifest.id });
      return installed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.bus.emit("plugin.install_failed", { pluginId, error: message });
      await rm(installDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async uninstall(pluginId: string): Promise<void> {
    const installed = this.registry.get(pluginId);
    await this.deps.pluginManager.disable(pluginId);

    if (installed) {
      await rm(installed.installDir, { recursive: true, force: true }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger.warn(`No se pudo borrar ${installed.installDir}: ${message}`);
      });
    }
    this.registry.remove(pluginId);
    this.deps.bus.emit("plugin.uninstalled", { pluginId });
  }

  /** Reconstruye cada `SidecarProxyPlugin` instalado en el boot del Edge Agent, sin volver a descargar nada. */
  async restoreInstalled(): Promise<void> {
    for (const installed of this.registry.list()) {
      await this.deps.pluginManager.register(new SidecarProxyPlugin(installed, this.deps.processLauncher));
    }
  }
}
