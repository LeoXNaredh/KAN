import type { PluginManifest } from "@kan/plugin-contract";

export abstract class KanPlugin {
  abstract readonly manifest: PluginManifest;

  get id(): string {
    return this.manifest.id;
  }

  /** Se llama cuando el Plugin Manager habilita el plugin. */
  async onLoad(): Promise<void> {}

  /** Se llama cuando el Plugin Manager lo deshabilita o la app cierra. */
  async onUnload(): Promise<void> {}
}
