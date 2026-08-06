import type { PluginManifest } from "@kan/plugin-contract";
import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";

export type PluginInstanceStatus = "loaded" | "enabled" | "disabled" | "error";

export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginInstanceStatus;
  driver: KanDeviceDriverPlugin;
}
