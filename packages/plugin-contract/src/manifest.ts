export type PluginKind = "device-driver" | "integration" | "processing";
export type PluginRuntime = "in-process-ts" | "python-sidecar";

/**
 * Modelo de permisos deny-by-default (ADR-008, P8): lo que un plugin
 * declara que necesita tocar. Capabilities no viven acá a propósito — ya
 * son dinámicas por dispositivo vía `KanDeviceDriverPlugin.getCapabilities()`;
 * duplicarlas en el manifest sería la misma divergencia manifest/
 * implementación que docs/04 §5 pide evitar.
 */
export interface PluginPermissions {
  /** Kinds de dispositivo que este plugin necesita controlar. */
  devices: string[];
  network: boolean;
  /** Declarativo, ej. "read:user-uploads" — sin enforcement real todavía. */
  filesystem: string[];
}

export interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  kind: PluginKind;
  runtime: PluginRuntime;
  permissions: PluginPermissions;
  /** Placeholder para firma criptográfica real (docs/09, Año 1/2) — no verificado todavía. */
  signature?: string;
}
