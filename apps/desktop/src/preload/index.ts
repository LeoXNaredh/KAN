import { contextBridge, ipcRenderer } from "electron";
import type { EdgeAgentEvents, InstalledPlugin } from "@kan/edge-agent-core";
import type { ActionSeverity, PluginManifest } from "@kan/plugin-contract";

export interface PluginCatalogEntryDTO {
  manifest: PluginManifest;
  description?: string;
}

export type BusEvent = {
  [K in keyof EdgeAgentEvents]: { type: K; payload: EdgeAgentEvents[K] };
}[keyof EdgeAgentEvents];

const kanApi = {
  listDevices: () => ipcRenderer.invoke("kan:listDevices"),
  listCapabilities: () => ipcRenderer.invoke("kan:listCapabilities"),
  invokeCapability: (deviceId: string, capabilityName: string, input: unknown) =>
    ipcRenderer.invoke("kan:invokeCapability", deviceId, capabilityName, input),
  resolveConfirmation: (confirmationId: string, approved: boolean) =>
    ipcRenderer.invoke("kan:resolveConfirmation", confirmationId, approved),
  getCoreStatus: () => ipcRenderer.invoke("kan:getCoreStatus"),
  listSafetyTargets: (deviceId: string) => ipcRenderer.invoke("kan:listSafetyTargets", deviceId),
  setSafetyPolicy: (deviceId: string, target: string, severity: ActionSeverity, alias?: string) =>
    ipcRenderer.invoke("kan:setSafetyPolicy", deviceId, target, severity, alias),
  getPairingStatus: (): Promise<{ paired: boolean }> => ipcRenderer.invoke("kan:getPairingStatus"),
  pairAgent: (code: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("kan:pair", code),
  syncPluginConfig: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("kan:syncPluginConfig"),
  listPendingPluginPermissions: () => ipcRenderer.invoke("kan:listPendingPluginPermissions"),
  approvePluginPermissions: (pluginId: string) => ipcRenderer.invoke("kan:approvePluginPermissions", pluginId),
  rejectPluginPermissions: (pluginId: string) => ipcRenderer.invoke("kan:rejectPluginPermissions", pluginId),
  // ADR-056 (Fase 5) — plugins sidecar bajo demanda.
  listPluginCatalog: (): Promise<PluginCatalogEntryDTO[]> => ipcRenderer.invoke("kan:listPluginCatalog"),
  listInstalledPlugins: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke("kan:listInstalledPlugins"),
  installPlugin: (pluginId: string): Promise<InstalledPlugin> => ipcRenderer.invoke("kan:installPlugin", pluginId),
  uninstallPlugin: (pluginId: string): Promise<void> => ipcRenderer.invoke("kan:uninstallPlugin", pluginId),
  onEvent: (handler: (event: BusEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: BusEvent) => handler(data);
    ipcRenderer.on("kan:event", listener);
    return () => {
      ipcRenderer.off("kan:event", listener);
    };
  },
};

export type KanApi = typeof kanApi;

contextBridge.exposeInMainWorld("kan", kanApi);
