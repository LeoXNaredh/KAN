// Polyfill de reflect requerido por tsyringe (dependencia de node-opcua,
// vía @kan/plugin-opcua) — debe ser el primer import del entry point real
// del proceso main, antes que cualquier otra cosa. Bug preexistente, no
// introducido por ADR-060: node-opcua ya se importaba estático antes; nunca
// se había corrido `apps/desktop` de punta a punta en este entorno.
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { access, constants, readFile } from "node:fs/promises";
import { platform } from "node:os";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  EdgeAgent,
  EdgeAgentBus,
  FileAndConsoleLogger,
  JsonFileConfigStore,
  JsonFileDeviceStore,
  CoreWebSocketClient,
  NoopUpdater,
  PluginInstaller,
  TarPluginPackageExtractor,
  PythonVenvManager,
  NodeProcessLauncher,
  SidecarProxyPlugin,
  resolveVenvPythonPath,
  DeviceDiscoveryPlugin,
  DeviceDiscoveryService,
  BonjourWifiScanner,
  NullBleScanner,
  loadVidPidCatalog,
  CustomVidPidCatalogStore,
  type BleDeviceScannerPort,
  type EdgeAgentEvents,
  type InstalledPlugin,
  type LoggerPort,
  type VidPidCatalogEntry,
} from "@kan/edge-agent-core";
import { validatePluginManifest, type ActionSeverity } from "@kan/plugin-contract";
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
// UI de catálogo VID/PID custom (requisito: agregar dispositivos sin editar
// vid-pid-custom.json a mano) — `customVidPidCatalogStore` persiste a disco;
// `liveVidPidCatalog` es la MISMA instancia de array que ya recibió
// `DeviceDiscoveryService` en su construcción (ver createEdgeAgent()) — se
// muta in-place después de cada add()/remove() para que el escaneo en curso
// vea el cambio sin reiniciar la app (ver refreshVidPidCatalog()).
let customVidPidCatalogStore: CustomVidPidCatalogStore | undefined;
let liveVidPidCatalog: VidPidCatalogEntry[] | undefined;
let vidPidCustomCatalogPath: string | undefined;

/** Ver el setInterval que la usa, cerca de agent.bootstrap() — detección en caliente de dispositivos seriales (ADR-060 incremento 2). */
const DEVICE_DISCOVERY_POLL_MS = 3_000;

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

/**
 * plugin-bluetooth-py (fix de auditoría de backend #5, BLE real vía
 * `bleak`) — a diferencia del resto de los sidecars de ADR-056 (instalados
 * bajo demanda vía `EdgeAgent.installPlugin()`, que descarga desde un
 * catálogo real en Supabase), este se registra "empaquetado": directo
 * desde su carpeta en el monorepo, sin pasar por el catálogo, porque no
 * hay uno real desplegado todavía (mismo límite ya documentado en ADR-056
 * Fase 4: "publicar un plugin al catálogo es un paso manual/admin"). Crea
 * su venv al primer arranque si hace falta (puede tardar — pip instala
 * `bleak` + `kan-plugin-sdk-py`) y lo reutiliza en los siguientes arranques.
 * Solo funciona corriendo desde un checkout del monorepo (dev): un build
 * empaquetado de Electron necesitaría copiar este directorio como recurso
 * — fuera de alcance de este fix, mismo criterio que "verificación manual"
 * ya aceptado para el resto de los sidecars Python (ADR-056, Fase 3).
 */
async function registerBundledBluetoothSidecar(agent: EdgeAgent, logger: LoggerPort): Promise<void> {
  const pluginDir = join(__dirname, "../../../../plugins/plugin-bluetooth-py");
  const manifestRaw = JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf-8"));
  const validation = validatePluginManifest(manifestRaw);
  if (!validation.ok) throw new Error(validation.error);

  const pythonPath = resolveVenvPythonPath(pluginDir);
  const venvReady = await access(pythonPath, constants.X_OK)
    .then(() => true)
    .catch(() => false);
  if (!venvReady) {
    logger.info("Creando el entorno virtual de Python para el plugin de Bluetooth (primera vez, puede tardar)...");
    const venvManager = new PythonVenvManager();
    const { pythonExecutablePath } = await venvManager.create(pluginDir);
    await venvManager.install(pythonExecutablePath, join(pluginDir, "requirements.txt"));
  }

  const installed: InstalledPlugin = {
    pluginId: validation.manifest.id,
    version: validation.manifest.version,
    manifest: validation.manifest,
    installDir: pluginDir,
    installedAt: new Date().toISOString(),
  };
  await agent.registerPlugin(new SidecarProxyPlugin(installed, new NodeProcessLauncher()));
}

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

  vidPidCustomCatalogPath = join(userDataDir, "vid-pid-custom.json");
  customVidPidCatalogStore = new CustomVidPidCatalogStore(vidPidCustomCatalogPath);

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
    // Memoria de dispositivos entre reinicios — mismo directorio que
    // config.json/vid-pid-custom.json, archivo propio (ver JsonFileDeviceStore).
    deviceStore: new JsonFileDeviceStore(join(userDataDir, "known-devices.json")),
  });

  // ADR-056 (Fase 5): venv puro, sin Docker como prerequisito (decisión de
  // alcance) — mismos 4 adapters reales diseñados/probados en Fase 3, ahora
  // conectados al Gateway real en vez de fakes de test. Construido y
  // enganchado acá (no dentro de `EdgeAgent`, ver `EdgeAgent.getPluginManager()`)
  // porque `PluginInstaller` arrastra `node:child_process` — solo un host
  // Node como este puede importarlo sin romper el bundle del navegador.
  agent.attachPluginInstaller(
    new PluginInstaller({
      pluginManager: agent.getPluginManager(),
      bus,
      logger,
      configStore,
      fetcher: (pluginPackageFetcher = new GatewayPluginPackageFetcher(configStore, edgeAgentId)),
      extractor: new TarPluginPackageExtractor(),
      venvManager: new PythonVenvManager(),
      processLauncher: new NodeProcessLauncher(),
      pluginsDir: join(userDataDir, "sidecar-plugins"),
    }),
  );

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

  // Detección automática de dispositivos conectados (ADR-060) — serial
  // (VID/PID contra catálogo), WiFi (mDNS pasivo, `bonjour-service`, puro
  // JS) y BLE (opcional).
  //
  // `@kan/serial-line-transport` (para `NodeSerialTransport`) se importa
  // dinámico acá, nunca estático arriba — hallazgo real, no solo el mismo
  // criterio defensivo que ESP32/Modbus/etc. (ADR-057): un `import` estático
  // de este paquete a nivel de módulo lo funde en el chunk de entrada
  // monolítico (`out/main/index.js`), y `serialport`/`@serialport/bindings-cpp`
  // pierde ahí la resolución relativa a su `.node` prebuild ("No native
  // build was found..."), aunque el mismo binding cargue perfecto bajo el
  // Node interno de Electron sin bundlear (justo lo que verificó ADR-057).
  // Import dinámico → chunk propio → la resolución relativa vuelve a
  // funcionar, igual que ya le pasa a los 5 plugins que dependen de este
  // mismo paquete. Confirmado en vivo: sin este cambio, la app entera
  // revienta al arrancar, no solo esta feature.
  try {
    const { NodeSerialTransport } = await import("@kan/serial-line-transport");

    // BLE usa el mismo criterio de import dinámico + try/catch que Raspberry
    // Pi (ADR-038): el intento de `@abandonware/noble` ya falló una vez en
    // este repo para plugin-bluetooth-generic por falta de Visual Studio
    // C++ (ver su README) — si vuelve a fallar acá, se degrada a
    // `NullBleScanner` (BLE ausente) sin tumbar el resto del escaneo.
    let bleScanner: BleDeviceScannerPort = new NullBleScanner();
    try {
      const { NobleBleScanner } = await import("@kan/edge-agent-core/ble");
      bleScanner = new NobleBleScanner();
    } catch (error) {
      logger.warn(`BLE no disponible para la detección de dispositivos (¿falta compilar @abandonware/noble?): ${error}`);
    }

    // Guardado en `liveVidPidCatalog` (no un literal inline): es la MISMA
    // instancia de array que `DeviceDiscoveryService` va a leer en cada
    // escaneo — `refreshVidPidCatalog()` la muta in-place después de
    // add()/remove() para que el próximo escaneo (o la detección en
    // caliente, cada pocos segundos) ya vea el catálogo actualizado, sin
    // reiniciar la app.
    liveVidPidCatalog = loadVidPidCatalog(vidPidCustomCatalogPath);
    await agent.registerPlugin(
      new DeviceDiscoveryPlugin(
        new DeviceDiscoveryService({
          serialTransport: new NodeSerialTransport(),
          wifiScanner: new BonjourWifiScanner(),
          bleScanner,
          logger,
          catalog: liveVidPidCatalog,
        }),
      ),
    );
  } catch (error) {
    logger.warn(`No se pudo cargar la detección automática de dispositivos (¿falta compilar una dependencia nativa?): ${error}`);
  }

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

  // plugin-bluetooth-generic (TS, FakeBluetoothTransport) sigue sin
  // registrarse a propósito: el intento de agregar `@abandonware/noble` se
  // abandonó (ver plugin-bluetooth-generic/README.md, "un solo intento, sin
  // depurar el entorno") y ese plugin hoy no tiene ningún transporte real.
  // Reemplazado por plugin-bluetooth-py (sidecar Python + bleak, fix de
  // auditoría de backend #5) — registrado abajo con el mismo criterio
  // try/catch que ESP32/Raspberry Pi: sin Python instalable, no tumba el
  // resto del Edge Agent.
  try {
    await registerBundledBluetoothSidecar(agent, logger);
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de Bluetooth (sidecar Python, ¿falta Python o bleak?): ${error}`);
  }

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

  // Import dinámico + try/catch — no por un ABI mismatch real (ADR-057:
  // verificado en vivo bajo el Node interno de Electron, `serialport` carga
  // y funciona sin rebuild, gracias a que `@serialport/bindings-cpp`
  // distribuye prebuilts N-API, estables de ABI entre Node y Electron), sino
  // como defensa barata ante una plataforma/arquitectura sin prebuild
  // publicado (ej. Windows ARM64) y ante fallos reales de discover() — con
  // KAN_ESP32_PORT sin fijar, este plugin escanea todos los puertos
  // seriales disponibles, y ese escaneo no debe tumbar el resto del Edge
  // Agent si falla.
  try {
    const { Esp32ArduinoPlugin } = await import("@kan/plugin-esp32-arduino");
    await agent.registerPlugin(new Esp32ArduinoPlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de ESP32/Arduino: ${error}`);
  }

  // Mismo criterio que ESP32 (ADR-057) — `modbus-serial` trae `serialport`
  // como dependencia opcional para su modo RTU (el modo TCP no lo
  // necesita, pero ambos viven en el mismo import). Import dinámico +
  // try/catch como defensa, no por un bloqueo de ABI real.
  try {
    const { ModbusDevicePlugin } = await import("@kan/plugin-modbus");
    await agent.registerPlugin(new ModbusDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de Modbus: ${error}`);
  }

  // Mismo criterio (ADR-057) — depende de @kan/serial-line-transport, que
  // envuelve `serialport` directamente.
  try {
    const { SerialGenericDevicePlugin } = await import("@kan/plugin-serial-generic");
    await agent.registerPlugin(new SerialGenericDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de puerto serial genérico: ${error}`);
  }

  // Mismo criterio (ADR-057) — también depende de
  // @kan/serial-line-transport (el adaptador SLCAN se enumera como puerto
  // serial estándar, sin ninguna dependencia de CAN Bus propia).
  try {
    const { CanbusDevicePlugin } = await import("@kan/plugin-canbus");
    await agent.registerPlugin(new CanbusDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de CAN Bus: ${error}`);
  }

  // Mismo criterio (ADR-057) — impresoras 3D/CNC por G-code también
  // dependen de @kan/serial-line-transport para el camino serial (el
  // camino WiFi/TCP, KAN_GCODE_WIFI_HOST, no lo necesita, pero ambos viven
  // en el mismo import).
  try {
    const { GcodeDevicePlugin } = await import("@kan/plugin-gcode");
    await agent.registerPlugin(new GcodeDevicePlugin());
  } catch (error) {
    logger.warn(`No se pudo cargar el plugin de G-code: ${error}`);
  }

  await agent.bootstrap();

  // Detección en caliente (ADR-060 incremento 2) — sondea solo enumeración
  // serial (rápida, consulta local al SO, ver DeviceDiscoveryService.scanSerial)
  // cada pocos segundos para notar un dispositivo recién enchufado sin
  // reiniciar la app ni pedir un rescan manual. Acotado a este único plugin
  // (rediscoverDriver, no rediscoverDevices) — no repite discover() en el
  // resto de los drivers habilitados en cada tick. No hace nada mientras el
  // plugin siga pendiente de aprobación de permisos.
  setInterval(() => {
    void agent
      .rediscoverDriver("kan-device-discovery")
      .catch((error) => logger.warn(`Detección en caliente: fallo al re-escanear puertos seriales: ${error}`));
  }, DEVICE_DISCOVERY_POLL_MS);

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
  // Bandeja de confirmaciones pendientes (requisito: verlas aunque la
  // ventana no estuviera abierta cuando se dispararon) — el renderer llama
  // esto al montar, además de seguir escuchando "permission.pending" en vivo.
  ipcMain.handle("kan:listPendingConfirmations", () => edgeAgent?.listPendingConfirmations() ?? []);
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
  // `PluginInstance.driver` es una instancia viva del plugin (métodos, posibles
  // handles nativos) — no es clonable por IPC ("An object could not be
  // cloned."), bug preexistente nunca disparado porque nadie había llegado acá
  // con un plugin realmente pendiente en este entorno. El renderer
  // (`toPendingPluginPermission` en App.tsx) solo usa `manifest`/`status`.
  ipcMain.handle(
    "kan:listPendingPluginPermissions",
    () => edgeAgent?.listPendingPluginPermissions().map(({ manifest, status }) => ({ manifest, status })) ?? [],
  );
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

  // Catálogo VID/PID custom (requisito: agregar dispositivos sin editar
  // vid-pid-custom.json a mano) — no depende de `edgeAgent` en sí
  // (`customVidPidCatalogStore` ya existe apenas createEdgeAgent() arranca a
  // computar `userDataDir`), solo de que ese setup temprano ya haya corrido.
  ipcMain.handle("kan:listCustomVidPidCatalog", () => customVidPidCatalogStore?.list() ?? []);
  ipcMain.handle(
    "kan:addCustomVidPidCatalogEntry",
    (_event, input: { name: string; vendorId: string; productId: string }) => addCustomVidPidCatalogEntry(input),
  );
  ipcMain.handle("kan:removeCustomVidPidCatalogEntry", (_event, vendorId: string, productId: string) => {
    customVidPidCatalogStore?.remove(vendorId, productId);
    refreshVidPidCatalog();
  });
}

/**
 * Vuelve a leer `vid-pid-custom.json` (base + custom mergeados, ver
 * `loadVidPidCatalog()`) y reemplaza el contenido de `liveVidPidCatalog` IN
 * PLACE — es la misma instancia de array que ya tiene `DeviceDiscoveryService`
 * (le llegó por referencia al construirse en `createEdgeAgent()`), así que el
 * próximo escaneo (o el próximo tick de detección en caliente, cada pocos
 * segundos) ve el catálogo actualizado sin reiniciar la app. No-op si el
 * Edge Agent todavía no llegó a esa parte de su arranque (`liveVidPidCatalog`
 * sigue `undefined`) — el cambio ya quedó guardado en disco igual, el
 * catálogo lo toma apenas termine de arrancar.
 */
function refreshVidPidCatalog(): void {
  if (!liveVidPidCatalog || !vidPidCustomCatalogPath) return;
  const fresh = loadVidPidCatalog(vidPidCustomCatalogPath);
  liveVidPidCatalog.splice(0, liveVidPidCatalog.length, ...fresh);
}

/**
 * Agrega un dispositivo al catálogo custom — mismo patrón de resultado
 * `{ok:true}|{ok:false,error}` que `pairAgent()`/`syncPluginConfig()`, así
 * la UI muestra el mensaje de validación (VID/PID inválido, ya existe...)
 * tal cual lo arma `CustomVidPidCatalogStore.add()`, en lenguaje simple, sin
 * depender de cómo Electron serialice un error lanzado por IPC.
 */
async function addCustomVidPidCatalogEntry(
  input: { name: string; vendorId: string; productId: string },
): Promise<{ ok: true; entry: VidPidCatalogEntry } | { ok: false; error: string }> {
  if (!customVidPidCatalogStore) {
    return { ok: false, error: "El Edge Agent todavía no terminó de arrancar." };
  }
  try {
    const entry = customVidPidCatalogStore.add(input);
    refreshVidPidCatalog();
    return { ok: true, entry };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido" };
  }
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
    // La escritura de JsonFileConfigStore ahora es async/debounced (fix de
    // auditoría de backend #6) — app.exit() no espera al event loop, así
    // que sin este flush() el pairingToken recién guardado podía perderse.
    await configStore.flush();
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
