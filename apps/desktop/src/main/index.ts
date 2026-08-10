import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { platform } from "node:os";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  EdgeAgent,
  EdgeAgentBus,
  FileAndConsoleLogger,
  JsonFileConfigStore,
  CoreWebSocketClient,
  NoopUpdater,
  TarPluginPackageExtractor,
  PythonVenvManager,
  NodeProcessLauncher,
  type EdgeAgentEvents,
} from "@kan/edge-agent-core";
import type { ActionSeverity } from "@kan/plugin-contract";
import { GatewayPluginPackageFetcher } from "./GatewayPluginPackageFetcher";
import { DeviceSimulatorPlugin } from "@kan/plugin-device-simulator";
import { HttpDevicePlugin } from "@kan/plugin-http-generic";
import { WsDevicePlugin } from "@kan/plugin-ws-generic";
import { HomeAssistantDevicePlugin } from "@kan/plugin-home-assistant";
import { NetworkToolsDevicePlugin } from "@kan/plugin-network-tools";
import { SshDevicePlugin } from "@kan/plugin-ssh";
import { OpcuaDevicePlugin } from "@kan/plugin-opcua";
import { MqttDevicePlugin } from "@kan/plugin-mqtt";

let mainWindow: BrowserWindow | null = null;
let edgeAgent: EdgeAgent | undefined;
let configStore: JsonFileConfigStore | undefined;
let edgeAgentId: string | undefined;
// ADR-056 (Fase 5) — referencia aparte de `edgeAgent.installPlugin()`: `EdgeAgent`
// no expone listar el catálogo (Fase 3 solo necesitaba instalar por id), pero
// la UI sí necesita mostrar qué hay disponible antes de instalar nada.
let pluginPackageFetcher: GatewayPluginPackageFetcher | undefined;

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
  "plugin.permission_pending",
  "plugin.permission_resolved",
  "safety_policy.changed",
  "core.status",
  "log",
  // ADR-056 (Fase 5) — progreso/resultado de instalar-desinstalar un plugin sidecar.
  "plugin.install_progress",
  "plugin.installed",
  "plugin.install_failed",
  "plugin.uninstalled",
];

function getOrCreateEdgeAgentId(configStore: JsonFileConfigStore): string {
  const existing = configStore.get<string>("edgeAgentId");
  if (existing) return existing;
  const id = randomUUID();
  configStore.set("edgeAgentId", id);
  return id;
}

/**
 * Config de plugins guardada desde /configuracion (apps/web), persistida en
 * Supabase y traída acá al aparear/sincronizar (ver `pairAgent()`/
 * `syncPluginConfig()`) — se aplica a `process.env` ANTES de registrar
 * ningún plugin, para que cada uno la lea exactamente igual que si viniera
 * de `.env.local` (`process.env.KAN_SSH_HOSTS`, etc.). Ningún plugin cambia:
 * siguen sin saber que esto existe. `.env.local`, si está presente, ya
 * corrió antes que este proceso arranque (dotenv/electron-vite) — esto
 * completa lo que falte, no lo pisa.
 */
function applyPluginConfig(configStore: JsonFileConfigStore, options: { overwrite?: boolean } = {}): void {
  const pluginConfig = configStore.get<Record<string, string>>("pluginConfig");
  if (!pluginConfig) return;
  for (const [key, value] of Object.entries(pluginConfig)) {
    // Al arrancar: `.env.local` (si está) ya corrió antes que este módulo,
    // así que gana si ya fijó la misma variable — esto solo completa lo que
    // falte. Al sincronizar a mano (`options.overwrite`), el usuario pidió
    // explícitamente traer lo último de la nube, así que sí pisa.
    if (options.overwrite || process.env[key] === undefined) process.env[key] = value;
  }
}

async function createEdgeAgent(): Promise<EdgeAgent> {
  const userDataDir = app.getPath("userData");
  const bus = new EdgeAgentBus();
  const logger = new FileAndConsoleLogger(join(userDataDir, "logs", "edge-agent.log"), bus);
  configStore = new JsonFileConfigStore(join(userDataDir, "config.json"));
  edgeAgentId = getOrCreateEdgeAgentId(configStore);
  applyPluginConfig(configStore);

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
    os: platform(),
    bus,
    logger,
    configStore,
    coreConnection,
    updater: new NoopUpdater(),
    // ADR-056 (Fase 5): venv puro, sin Docker como prerequisito (decisión
    // de alcance) — mismos 4 adapters reales diseñados/probados en Fase 3,
    // ahora conectados al Gateway real en vez de fakes de test.
    pluginInstaller: {
      pluginPackageFetcher: (pluginPackageFetcher = new GatewayPluginPackageFetcher(configStore, edgeAgentId)),
      pluginPackageExtractor: new TarPluginPackageExtractor(),
      venvManager: new PythonVenvManager(),
      processLauncher: new NodeProcessLauncher(),
      pluginsDir: join(userDataDir, "sidecar-plugins"),
    },
  });

  // Registrado ANTES de los try/catch de plugins de abajo a propósito (P3.7):
  // `EdgeAgentBus.emit()` no hace buffering (ver EdgeAgentBus.ts) — un
  // `logger.warn()` disparado durante el registro de ESP32/Modbus/etc. antes
  // de que exista un listener del evento "log" se pierde para siempre. Antes
  // este bloque vivía después de `agent.bootstrap()`, así que el aviso de
  // "no se pudo cargar el plugin de ESP32 (¿falta Visual Studio?)" nunca
  // llegaba al renderer — silencio total, aunque el mensaje sí se escribía
  // bien en el log file. Con el forwarding ya armado, ese mismo "log" llega
  // al renderer y App.tsx lo muestra como aviso (ver pluginWarnings ahí).
  for (const eventName of FORWARDED_EVENTS) {
    bus.on(eventName, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("kan:event", { type: eventName, payload });
      }
    });
  }

  await agent.registerPlugin(new DeviceSimulatorPlugin());

  // Sin binding nativo — puro JS, sin el riesgo de ABI de Electron que sí
  // aplica a serialport (ver más abajo). Registro estático, mismo criterio
  // que DeviceSimulatorPlugin.
  await agent.registerPlugin(new HttpDevicePlugin());
  await agent.registerPlugin(new WsDevicePlugin());
  await agent.registerPlugin(new HomeAssistantDevicePlugin());
  await agent.registerPlugin(new NetworkToolsDevicePlugin());
  // ssh2 sí tiene una dependencia opcional nativa (cpu-features, solo
  // aceleración de crypto) — denegada explícitamente en pnpm-workspace.yaml
  // (allowBuilds), así que corre siempre en su fallback puro JS. Sin riesgo
  // de ABI de Electron, registro estático.
  await agent.registerPlugin(new SshDevicePlugin());
  await agent.registerPlugin(new OpcuaDevicePlugin());
  await agent.registerPlugin(new MqttDevicePlugin());

  // plugin-bluetooth-generic NO se registra a propósito (a diferencia de lo
  // que un comentario más abajo podría sugerir por comparación): no es un
  // caso de "falla el binding nativo en tiempo de ejecución" como
  // ESP32/Modbus/serial — es que ese plugin hoy no tiene ningún transporte
  // real en absoluto. El intento de agregar `@abandonware/noble` se
  // abandonó (ver plugin-bluetooth-generic/README.md, "un solo intento, sin
  // depurar el entorno") y su constructor por defecto usa
  // `FakeBluetoothTransport([])` — registrarlo hoy mostraría un plugin
  // "Bluetooth" que nunca encuentra nada, más confuso que útil. Queda para
  // cuando exista el sidecar en Python (`bleak`) documentado como
  // incremento futuro en ese mismo README.

  // Import dinámico + try/catch (ADR-038): `onoff` trae una dependencia
  // nativa transitiva (`epoll`) — si su binding no carga en este proceso de
  // Electron (ABI distinto al Node del sistema), esto no debe tumbar el
  // resto del Edge Agent (simulador incluido) para quien ni siquiera tiene
  // una Raspberry Pi.
  try {
    const { RaspberryPiGpioPlugin } = await import("@kan/plugin-raspberry-pi");
    await agent.registerPlugin(new RaspberryPiGpioPlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de Raspberry Pi (¿falta compilar una dependencia nativa?): ${error}`);
  }

  // Import dinámico + try/catch, mismo criterio que Raspberry Pi: el
  // constructor de Esp32ArduinoPlugin por defecto usa transportes reales
  // (NodeSerialTransport/NodeTcpTransport, @kan/serial-line-transport), y
  // serialport trae un binding nativo (.node). Confirmado en vivo (no solo
  // hipotético, como para Raspberry Pi): carga bien bajo el Node del
  // sistema (por eso los tests de este plugin siempre pasan), pero NO bajo
  // el ABI de Node que usa Electron — sin binario prebuildeado para
  // platform=win32/electron/abi=130 en esta máquina. `pnpm --filter desktop
  // rebuild:native` (electron-rebuild) puede resolverlo si tenés instalado
  // Visual Studio Build Tools ("Desktop development with C++") — acá no
  // está, mismo bloqueo exacto que @abandonware/noble en
  // plugin-bluetooth-generic (ver ese README). No se automatizó como
  // postinstall a propósito: un postinstall que falla por Visual Studio
  // ausente rompe `pnpm install` para todo el monorepo, no solo este
  // plugin. Sin ESP32 conectado, discover() no debe tumbar nada — con
  // KAN_ESP32_PORT sin fijar, igual escanea todos los puertos seriales
  // disponibles (a diferencia de Raspberry Pi, que no escanea nada fuera de
  // una Pi real), así que este catch cubre tanto un fallo de carga del
  // binding como cualquier error de descubrimiento.
  try {
    const { Esp32ArduinoPlugin } = await import("@kan/plugin-esp32-arduino");
    await agent.registerPlugin(new Esp32ArduinoPlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de ESP32/Arduino (¿falta compilar una dependencia nativa?): ${error}`);
  }

  // Mismo riesgo de binding nativo que ESP32/Arduino: `modbus-serial` trae
  // `serialport` para su modo RTU (el modo TCP no lo necesita, pero ambos
  // viven en el mismo paquete/import). Import dinámico + try/catch.
  try {
    const { ModbusDevicePlugin } = await import("@kan/plugin-modbus");
    await agent.registerPlugin(new ModbusDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de Modbus (¿falta compilar una dependencia nativa?): ${error}`);
  }

  // Mismo riesgo de binding nativo — depende de @kan/serial-line-transport,
  // que envuelve `serialport` directamente.
  try {
    const { SerialGenericDevicePlugin } = await import("@kan/plugin-serial-generic");
    await agent.registerPlugin(new SerialGenericDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de puerto serial genérico (¿falta compilar una dependencia nativa?): ${error}`);
  }

  // Mismo riesgo de binding nativo — también depende de
  // @kan/serial-line-transport (el adaptador SLCAN se enumera como puerto
  // serial estándar, sin ninguna dependencia de CAN Bus propia).
  try {
    const { CanbusDevicePlugin } = await import("@kan/plugin-canbus");
    await agent.registerPlugin(new CanbusDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de CAN Bus (¿falta compilar una dependencia nativa?): ${error}`);
  }

  // Mismo riesgo de binding nativo — impresoras 3D/CNC por G-code también
  // dependen de @kan/serial-line-transport para el camino serial (el
  // camino WiFi/TCP, KAN_GCODE_WIFI_HOST, no lo necesita, pero ambos viven
  // en el mismo import).
  try {
    const { GcodeDevicePlugin } = await import("@kan/plugin-gcode");
    await agent.registerPlugin(new GcodeDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de G-code (¿falta compilar una dependencia nativa?): ${error}`);
  }

  await agent.bootstrap();

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
  ipcMain.handle("kan:syncPluginConfig", () => syncPluginConfig());
  ipcMain.handle("kan:listPendingPluginPermissions", () => edgeAgent?.listPendingPluginPermissions() ?? []);
  ipcMain.handle("kan:approvePluginPermissions", (_event, pluginId: string) => {
    if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return edgeAgent.approvePluginPermissions(pluginId);
  });
  ipcMain.handle("kan:rejectPluginPermissions", (_event, pluginId: string) => {
    if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return edgeAgent.rejectPluginPermissions(pluginId);
  });
  // ADR-056 (Fase 5) — plugins sidecar bajo demanda.
  ipcMain.handle("kan:listPluginCatalog", () => {
    if (!pluginPackageFetcher) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return pluginPackageFetcher.listCatalog();
  });
  ipcMain.handle("kan:listInstalledPlugins", () => edgeAgent?.listInstalledPlugins() ?? []);
  ipcMain.handle("kan:installPlugin", (_event, pluginId: string) => {
    if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return edgeAgent.installPlugin(pluginId);
  });
  ipcMain.handle("kan:uninstallPlugin", (_event, pluginId: string) => {
    if (!edgeAgent) throw new Error("El Edge Agent todavía no terminó de arrancar.");
    return edgeAgent.uninstallPlugin(pluginId);
  });
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
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      secret?: string;
      pluginConfig?: Record<string, string>;
    };
    if (!response.ok) {
      return { ok: false, error: body.error ?? "No se pudo vincular." };
    }

    configStore.set("pairingToken", body.secret);
    // Si el usuario ya había guardado config de plugins en /configuracion
    // antes de aparear, la trae de una — sin esto, quedaría esperando a
    // "Sincronizar configuración" a mano después del primer arranque.
    if (body.pluginConfig) configStore.set("pluginConfig", body.pluginConfig);
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

/**
 * Trae la config de plugins más reciente desde el Gateway (sin re-aparear)
 * y la aplica en caliente — botón "Sincronizar configuración" en el
 * renderer. Autenticado con el mismo `pairingToken` que ya usa el hello por
 * WS, mandado por header (nunca en la URL).
 */
async function syncPluginConfig(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!configStore || !edgeAgentId) {
    return { ok: false, error: "El Edge Agent todavía no terminó de arrancar." };
  }
  const pairingToken = configStore.get<string>("pairingToken");
  if (!pairingToken) {
    return { ok: false, error: "Todavía no vinculaste este Edge Agent con tu cuenta." };
  }

  try {
    const gatewayHttpUrl = process.env.KAN_GATEWAY_HTTP_URL ?? "http://localhost:8787";
    const response = await fetch(`${gatewayHttpUrl}/v1/pairing/config`, {
      headers: { "X-Pairing-Secret": pairingToken, "X-Edge-Agent-Id": edgeAgentId },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; pluginConfig?: Record<string, string> };
    if (!response.ok) {
      return { ok: false, error: body.error ?? "No se pudo sincronizar." };
    }

    configStore.set("pluginConfig", body.pluginConfig ?? {});
    applyPluginConfig(configStore, { overwrite: true });
    // Sin reiniciar el proceso: los plugins ya registrados vuelven a
    // descubrir con el `process.env` recién actualizado.
    await edgeAgent?.rediscoverDevices();
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
