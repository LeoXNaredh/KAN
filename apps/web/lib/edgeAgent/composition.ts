import {
  EdgeAgent,
  EdgeAgentBus,
  BrowserWebSocketClient,
  LocalStorageConfigStore,
  ConsoleLogger,
  NoopUpdater,
} from "@kan/edge-agent-core/browser";
import { DeviceSimulatorPlugin } from "@kan/plugin-device-simulator";

const CONFIG_STORAGE_KEY = "kan:edgeAgentConfig";
const AGENT_VERSION = "browser-1";

/**
 * Pide un ticket de un solo uso a /api/edge-ticket (que a su vez lo pide al
 * Gateway con la sesión del usuario ya autenticado) y arma la URL completa
 * del WS /edge. Se llama en cada intento de conexión, no una sola vez — ver
 * BrowserWebSocketClient.
 */
async function fetchTicketUrl(): Promise<string> {
  const response = await fetch("/api/edge-ticket", { method: "POST" });
  if (!response.ok) {
    throw new Error(`No se pudo obtener un ticket de conexión (status ${response.status})`);
  }
  const { ticket } = (await response.json()) as { ticket: string };

  const wsUrl = process.env.NEXT_PUBLIC_KAN_GATEWAY_WS_URL;
  if (!wsUrl) {
    throw new Error("Falta NEXT_PUBLIC_KAN_GATEWAY_WS_URL.");
  }
  return `${wsUrl}?ticket=${encodeURIComponent(ticket)}`;
}

function getOrCreateEdgeAgentId(configStore: LocalStorageConfigStore): string {
  const existing = configStore.get<string>("edgeAgentId");
  if (existing) return existing;
  const id = crypto.randomUUID();
  configStore.set("edgeAgentId", id);
  return id;
}

/**
 * Composition root del Edge Agent del Simulador corriendo en el navegador
 * (mismo rol que createEdgeAgent() en apps/desktop/src/main/index.ts, pero
 * sin Electron/IPC/renderer — solo el plugin Simulador, software puro).
 */
export function createBrowserEdgeAgent(): EdgeAgent {
  const bus = new EdgeAgentBus();
  const logger = new ConsoleLogger(bus);
  const configStore = new LocalStorageConfigStore(CONFIG_STORAGE_KEY);
  const edgeAgentId = getOrCreateEdgeAgentId(configStore);
  const coreConnection = new BrowserWebSocketClient(fetchTicketUrl, bus, logger);

  return new EdgeAgent({
    edgeAgentId,
    agentVersion: AGENT_VERSION,
    bus,
    logger,
    configStore,
    coreConnection,
    updater: new NoopUpdater(),
  });
}

export function createSimulatorPlugin(): DeviceSimulatorPlugin {
  return new DeviceSimulatorPlugin();
}
