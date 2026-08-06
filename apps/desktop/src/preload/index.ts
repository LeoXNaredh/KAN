import { contextBridge, ipcRenderer } from "electron";
import type { EdgeAgentEvents } from "@kan/edge-agent-core";
import type { ActionSeverity } from "@kan/plugin-contract";

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
