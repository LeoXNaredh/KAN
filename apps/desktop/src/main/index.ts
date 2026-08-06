import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  EdgeAgent,
  EdgeAgentBus,
  FileAndConsoleLogger,
  JsonFileConfigStore,
  CoreWebSocketClient,
  NoopUpdater,
  type EdgeAgentEvents,
} from "@kan/edge-agent-core";
import { DeviceSimulatorPlugin } from "@kan/plugin-device-simulator";

let mainWindow: BrowserWindow | null = null;
let edgeAgent: EdgeAgent;

const FORWARDED_EVENTS: Array<keyof EdgeAgentEvents> = [
  "plugin.loaded",
  "plugin.error",
  "device.connected",
  "device.disconnected",
  "capability.invoked",
  "capability.completed",
  "capability.failed",
  "permission.pending",
  "permission.resolved",
  "core.status",
  "log",
];

function getOrCreateEdgeAgentId(configStore: JsonFileConfigStore): string {
  const existing = configStore.get<string>("edgeAgentId");
  if (existing) return existing;
  const id = randomUUID();
  configStore.set("edgeAgentId", id);
  return id;
}

async function createEdgeAgent(): Promise<EdgeAgent> {
  const userDataDir = app.getPath("userData");
  const bus = new EdgeAgentBus();
  const logger = new FileAndConsoleLogger(join(userDataDir, "logs", "edge-agent.log"), bus);
  const configStore = new JsonFileConfigStore(join(userDataDir, "config.json"));

  // Sin servidor de Core todavía (ADR-009): esto reintentará indefinidamente
  // con backoff. Es el comportamiento esperado (Modo Offline, requisito 14).
  const coreConnection = new CoreWebSocketClient(
    process.env.KAN_CORE_WS_URL ?? "ws://localhost:8787/edge",
    process.env.KAN_CORE_TOKEN ?? "dev-token",
    bus,
    logger,
  );

  const agent = new EdgeAgent({
    edgeAgentId: getOrCreateEdgeAgentId(configStore),
    bus,
    logger,
    configStore,
    coreConnection,
    updater: new NoopUpdater(),
  });

  await agent.registerPlugin(new DeviceSimulatorPlugin());
  await agent.bootstrap();

  for (const eventName of FORWARDED_EVENTS) {
    bus.on(eventName, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("kan:event", { type: eventName, payload });
      }
    });
  }

  return agent;
}

function registerIpcHandlers(): void {
  ipcMain.handle("kan:listDevices", () => edgeAgent.listDevices());
  ipcMain.handle("kan:listCapabilities", () => edgeAgent.listCapabilities());
  ipcMain.handle("kan:invokeCapability", (_event, deviceId: string, capabilityName: string, input: unknown) =>
    edgeAgent.invokeCapability(deviceId, capabilityName, input),
  );
  ipcMain.handle("kan:resolveConfirmation", (_event, confirmationId: string, approved: boolean) =>
    edgeAgent.resolveConfirmation(confirmationId, approved),
  );
  ipcMain.handle("kan:getCoreStatus", () => edgeAgent.getCoreConnectionStatus());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  createWindow();
  edgeAgent = await createEdgeAgent();
  registerIpcHandlers();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void edgeAgent?.shutdown();
  if (process.platform !== "darwin") app.quit();
});
