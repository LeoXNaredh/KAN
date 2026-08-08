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
import type { ActionSeverity } from "@kan/plugin-contract";
import { DeviceSimulatorPlugin } from "@kan/plugin-device-simulator";

let mainWindow: BrowserWindow | null = null;
let edgeAgent: EdgeAgent | undefined;
let configStore: JsonFileConfigStore | undefined;
let edgeAgentId: string | undefined;

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
  "safety_policy.changed",
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
  configStore = new JsonFileConfigStore(join(userDataDir, "config.json"));
  edgeAgentId = getOrCreateEdgeAgentId(configStore);

  // Sin servidor de Core todavía (ADR-009): esto reintentará indefinidamente
  // con backoff. Es el comportamiento esperado (Modo Offline, requisito 14).
  const coreConnection = new CoreWebSocketClient(
    process.env.KAN_CORE_WS_URL ?? "ws://localhost:8787/edge",
    process.env.KAN_CORE_TOKEN ?? "dev-token",
    bus,
    logger,
  );

  const agent = new EdgeAgent({
    edgeAgentId,
    agentVersion: app.getVersion(),
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

/**
 * Se registra ANTES de crear la ventana (ver app.whenReady más abajo) para
 * que el renderer nunca llame a un canal sin handler ("No handler
 * registered", hallazgo A5 de docs/13). Mientras el Edge Agent todavía no
 * terminó de arrancar, los handlers devuelven un estado vacío/"desconectado"
 * en vez de fallar con un error críptico.
 */
function registerIpcHandlers(): void {
  ipcMain.handle("kan:listDevices", () => edgeAgent?.listDevices() ?? []);
  ipcMain.handle("kan:listCapabilities", () => edgeAgent?.listCapabilities() ?? []);
  ipcMain.handle("kan:invokeCapability", (_event, deviceId: string, capabilityName: string, input: unknown) => {
    if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return edgeAgent.invokeCapability(deviceId, capabilityName, input);
  });
  ipcMain.handle("kan:resolveConfirmation", (_event, confirmationId: string, approved: boolean) => {
    if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return edgeAgent.resolveConfirmation(confirmationId, approved);
  });
  ipcMain.handle("kan:getCoreStatus", () => edgeAgent?.getCoreConnectionStatus() ?? "disconnected");
  ipcMain.handle("kan:listSafetyTargets", (_event, deviceId: string) => edgeAgent?.listSafetyTargets(deviceId) ?? []);
  ipcMain.handle(
    "kan:setSafetyPolicy",
    (_event, deviceId: string, target: string, severity: ActionSeverity, alias?: string) => {
      if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
      return edgeAgent.setSafetyPolicy(deviceId, target, severity, alias);
    },
  );
  ipcMain.handle("kan:getPairingStatus", () => ({ paired: Boolean(configStore?.get<string>("pairingToken")) }));
  ipcMain.handle("kan:pair", (_event, code: string) => pairAgent(code));
}

/**
 * Reclama un código de pairing contra el Gateway (docs/19 P2, incremento 3)
 * — HTTP plano, no WS: no hace falta ningún cliente nuevo, Electron ya
 * tiene `fetch` global. Sin token interno: esta ruta no lo exige (ver
 * apps/gateway/src/http/pairingRoutes.ts), a propósito, porque este proceso
 * nunca tiene ese secreto de servidor.
 */
async function pairAgent(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!configStore || !edgeAgentId) {
    return { ok: false, error: "El Edge Agent todavía no terminó de arrancar." };
  }

  try {
    const gatewayHttpUrl = process.env.KAN_GATEWAY_HTTP_URL ?? "http://localhost:8787";
    const response = await fetch(`${gatewayHttpUrl}/v1/pairing/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: code, edgeAgentId }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; secret?: string };
    if (!response.ok) {
      return { ok: false, error: body.error ?? "No se pudo vincular." };
    }

    configStore.set("pairingToken", body.secret);
    // El hello ya enviado en esta sesión no lleva el pairingToken — más
    // simple y seguro reiniciar que mutar en caliente la conexión ya
    // establecida. El próximo arranque lo manda desde el primer hello.
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo contactar al Gateway." };
  }
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
  registerIpcHandlers();
  createWindow();
  edgeAgent = await createEdgeAgent();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void edgeAgent?.shutdown();
  if (process.platform !== "darwin") app.quit();
});
