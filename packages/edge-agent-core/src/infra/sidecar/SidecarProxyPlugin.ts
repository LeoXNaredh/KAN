import { randomBytes } from "node:crypto";
import type {
  CapabilityDescriptor,
  CapabilityResult,
  ConnectResultMessage,
  DeviceDescriptor,
  DisconnectResultMessage,
  DiscoverResultMessage,
  InvokeResultMessage,
  ListTargetsResultMessage,
  PluginManifest,
  TargetDescriptor,
} from "@kan/plugin-contract";
import { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { InstalledPlugin } from "../../domain/entities/InstalledPlugin";
import type { ManagedProcess, ProcessLauncherPort } from "../../domain/ports/ProcessLauncherPort";
import { resolveVenvPythonPath } from "../PythonVenvManager";
import { SidecarWsHost } from "./SidecarWsHost";

const HELLO_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 5_000;

export interface SidecarCommand {
  command: string;
  args: string[];
}

/** Comando real de producción: el runner de `kan-plugin-sdk-py` dentro del venv del plugin. */
export function defaultSidecarCommand(installedPlugin: InstalledPlugin): SidecarCommand {
  return {
    command: resolveVenvPythonPath(installedPlugin.installDir),
    args: ["-m", "kan_plugin_sdk_py.runner", installedPlugin.installDir],
  };
}

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Implementa `KanDeviceDriverPlugin` traduciendo cada llamada a RPC sobre
 * `SidecarWsHost` (ADR-056) — `PluginManager.register()` no distingue esta
 * clase de un driver in-process cualquiera, mismo contrato exacto.
 */
export class SidecarProxyPlugin extends KanDeviceDriverPlugin {
  readonly kind: string;
  readonly manifest: PluginManifest;

  private host: SidecarWsHost | undefined;
  private process: ManagedProcess | undefined;
  private readonly capabilitiesByDevice = new Map<string, CapabilityDescriptor[]>();
  private readonly targetsByDevice = new Map<string, TargetDescriptor[]>();

  /**
   * `resolveCommand` es inyectable a propósito — mismo criterio que
   * `constructor(transport = new NodeSerialTransport())` en el resto de
   * los plugins de hardware: el default es el camino real de producción
   * (Python), y los tests (`SidecarProxyPlugin.test.ts`) pasan un comando
   * que corre un fixture Node en su lugar, para ejercitar un proceso real
   * sin depender de que este entorno tenga Python/venv.
   */
  constructor(
    private readonly installedPlugin: InstalledPlugin,
    private readonly processLauncher: ProcessLauncherPort,
    private readonly resolveCommand: (installedPlugin: InstalledPlugin) => SidecarCommand = defaultSidecarCommand,
  ) {
    super();
    this.manifest = installedPlugin.manifest;
    this.kind = installedPlugin.manifest.id;
  }

  async onLoad(): Promise<void> {
    const token = randomBytes(24).toString("hex");
    const host = new SidecarWsHost(this.manifest.id, token);
    this.host = host;
    const { port } = await host.start();

    const { command, args } = this.resolveCommand(this.installedPlugin);
    let stderrBuffer = "";
    const managedProcess = this.processLauncher.spawn(command, args, {
      env: {
        ...sanitizedEnv(),
        KAN_SIDECAR_WS_URL: `ws://127.0.0.1:${port}`,
        KAN_SIDECAR_TOKEN: token,
      },
    });
    this.process = managedProcess;
    managedProcess.onStderr((chunk) => {
      stderrBuffer += chunk;
    });

    let helloSettled = false;
    const earlyExit = new Promise<never>((_, reject) => {
      managedProcess.onExit((code, signal) => {
        if (helloSettled) return;
        reject(
          new Error(
            `El proceso del sidecar "${this.manifest.id}" terminó antes de completar el handshake (code=${code}, signal=${signal}): ${stderrBuffer.trim() || "sin salida en stderr"}`,
          ),
        );
      });
    });

    try {
      await Promise.race([host.waitForHello(HELLO_TIMEOUT_MS), earlyExit]);
      helloSettled = true;
    } catch (error) {
      helloSettled = true;
      host.close();
      managedProcess.kill("SIGKILL");
      throw error;
    }
  }

  async onUnload(): Promise<void> {
    const process_ = this.process;
    const host = this.host;
    if (!process_) {
      host?.close();
      return;
    }

    await new Promise<void>((resolve) => {
      let exited = false;
      process_.onExit(() => {
        exited = true;
        resolve();
      });

      host?.sendShutdown();

      setTimeout(() => {
        if (!exited) process_.kill("SIGTERM");
      }, SHUTDOWN_GRACE_MS).unref?.();

      setTimeout(() => {
        if (!exited) process_.kill("SIGKILL");
      }, SHUTDOWN_GRACE_MS * 2).unref?.();
    });

    host?.close();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const response = await this.host!.request<DiscoverResultMessage>({ type: "discover" });
    return response.devices;
  }

  async connect(deviceId: string): Promise<void> {
    const response = await this.host!.request<ConnectResultMessage>({ type: "connect", deviceId });
    if (!response.ok) throw new Error(response.error ?? `No se pudo conectar a ${deviceId}.`);
    this.capabilitiesByDevice.set(deviceId, response.capabilities ?? []);

    try {
      const targetsResponse = await this.host!.request<ListTargetsResultMessage>({ type: "list_targets", deviceId });
      this.targetsByDevice.set(deviceId, targetsResponse.targets);
    } catch {
      // Un sidecar que no distingue list_targets (o que tarda demasiado en
      // responder) no debe romper connect() — mismo default vacío que
      // `KanDeviceDriverPlugin.listTargets()` del lado in-process.
      this.targetsByDevice.set(deviceId, []);
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    await this.host!.request<DisconnectResultMessage>({ type: "disconnect", deviceId });
    this.capabilitiesByDevice.delete(deviceId);
    this.targetsByDevice.delete(deviceId);
  }

  getCapabilities(deviceId: string): CapabilityDescriptor[] {
    // Síncrono a propósito (mismo contrato que el resto de los drivers) —
    // se cachea en connect(), ver `DeviceManager.discoverAndConnect()`
    // (`await connect()` seguido de `getCapabilities()` inmediato).
    return this.capabilitiesByDevice.get(deviceId) ?? [];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const response = await this.host!.request<InvokeResultMessage>({
      type: "invoke",
      deviceId,
      capability: capabilityName,
      input,
    });
    return response.result;
  }

  listTargets(deviceId: string): TargetDescriptor[] {
    return this.targetsByDevice.get(deviceId) ?? [];
  }
}
