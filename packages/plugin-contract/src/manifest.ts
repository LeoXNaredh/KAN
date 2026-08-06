export type PluginKind = "device-driver" | "integration" | "processing";
export type PluginRuntime = "in-process-ts" | "python-sidecar";

export interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  kind: PluginKind;
  runtime: PluginRuntime;
}
