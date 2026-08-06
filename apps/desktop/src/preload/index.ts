import { contextBridge, ipcRenderer } from "electron";

const kanApi = {
  listDevices: () => ipcRenderer.invoke("kan:listDevices"),
  listCapabilities: () => ipcRenderer.invoke("kan:listCapabilities"),
  invokeCapability: (deviceId: string, capabilityName: string, input: unknown) =>
    ipcRenderer.invoke("kan:invokeCapability", deviceId, capabilityName, input),
  resolveConfirmation: (confirmationId: string, approved: boolean) =>
    ipcRenderer.invoke("kan:resolveConfirmation", confirmationId, approved),
  getCoreStatus: () => ipcRenderer.invoke("kan:getCoreStatus"),
  onEvent: (handler: (event: { type: string; payload: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { type: string; payload: unknown }) =>
      handler(data);
    ipcRenderer.on("kan:event", listener);
    return () => {
      ipcRenderer.off("kan:event", listener);
    };
  },
};

export type KanApi = typeof kanApi;

contextBridge.exposeInMainWorld("kan", kanApi);
