import type {
  CapabilityDescriptor,
  CapabilityResult,
  DeviceDescriptor,
  PluginManifest,
  ProjectBackupType,
  ProjectDriverPort,
  ProjectFileEntry,
  SnapshotTransportPort,
} from "@kan/plugin-contract";
import { createProjectCapabilities, definePermissions, handleProjectCapability, KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import { enterRawRepl, type RawReplSession } from "./rawRepl";
import { buildListFilesScript, buildReadFileScript, buildWriteFileScript } from "./snippets";
import { NodeRawSerialTransport } from "./infra/NodeRawSerialTransport";
import type { RawSerialConnection, RawSerialTransportPort } from "./RawSerialTransportPort";

const BAUD_RATE = 115200;
// El banner de raw REPL puede tardar más que un ping de wire-protocol propio
// (Ctrl-C interrumpe primero lo que esté corriendo en el device) — más
// generoso que el PROBE_TIMEOUT_MS de plugin-esp32-arduino (500ms) a propósito.
const PROBE_TIMEOUT_MS = 800;
// Leer/escribir un archivo (base64 de por medio) puede tardar más que un
// comando de GPIO — generoso para no fallar en flash lenta.
const EXEC_TIMEOUT_MS = 5000;

function sanitizeDeviceId(path: string): string {
  return `micropython_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Última línea `path size` de `buildListFilesScript()` — separa por el
 * ÚLTIMO espacio, no el primero: un path no puede tener espacios
 * (`assertValidDevicePath`), así que todo lo anterior al último espacio es
 * el path tal cual, y lo posterior el tamaño en bytes.
 */
function parseListFilesOutput(stdout: string): ProjectFileEntry[] {
  const text = stdout.trim();
  if (!text) return [];
  return text.split("\n").map((line) => {
    const spaceIndex = line.lastIndexOf(" ");
    if (spaceIndex === -1) return { path: line };
    const sizeText = line.slice(spaceIndex + 1);
    if (!/^\d+$/.test(sizeText)) return { path: line };
    return { path: line.slice(0, spaceIndex), sizeBytes: Number(sizeText) };
  });
}

/**
 * Plataforma A (docs/06, backup/restore de proyecto): Pico / ESP32 con
 * MicroPython, backup por raw REPL — código fuente real y legible, a
 * diferencia de plugin-esp32-arduino (firmware Arduino C++ propio, wire
 * protocol JSON) o los drivers de PLC (solo config de KAN). Este driver no
 * expone ninguna capability de control (GPIO, etc.) — su único trabajo es
 * `ProjectDriverPort` vía `createProjectCapabilities()`/
 * `handleProjectCapability()` (@kan/plugin-sdk-ts); si en el futuro hace
 * falta control en vivo de un board MicroPython, es un plugin/capability
 * aparte, no parte de este.
 *
 * Entra a raw REPL en `connect()` y se queda ahí para toda la sesión — el
 * programa del usuario (`main.py`) queda pausado mientras el dispositivo
 * está "conectado" en KAN, mismo trade-off que `mpremote`/`ampy`. Vuelve a
 * la REPL amigable recién en `disconnect()` (Ctrl-B).
 */
export class MicroPythonPlugin extends KanDeviceDriverPlugin implements ProjectDriverPort {
  readonly kind = "micropython";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-micropython",
    version: "0.1.0",
    displayName: "MicroPython (Pico / ESP32 con MicroPython)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["micropython"], network: false, filesystem: [] }),
  };

  private readonly connectionPaths = new Map<string, string>();
  private readonly sessions = new Map<string, { connection: RawSerialConnection; session: RawReplSession }>();

  constructor(
    private readonly transport: RawSerialTransportPort = new NodeRawSerialTransport(),
    private readonly snapshotTransport: SnapshotTransportPort,
  ) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const found: DeviceDescriptor[] = [];
    const forcedPath = process.env.KAN_MICROPYTHON_PORT;
    const candidates = forcedPath ? [forcedPath] : (await this.transport.list()).map((port) => port.path);

    for (const path of candidates) {
      const isMicroPython = await this.probe(path);
      if (!isMicroPython) continue;
      const deviceId = sanitizeDeviceId(path);
      this.connectionPaths.set(deviceId, path);
      found.push({ id: deviceId, name: `MicroPython (${path})`, kind: this.kind, transport: "serial", address: path });
    }
    return found;
  }

  /** Abre, intenta entrar a raw REPL, sale y cierra — nunca deja una conexión de sondeo colgada ni un board de un tercero atascado en raw REPL. */
  private async probe(path: string): Promise<boolean> {
    let connection: RawSerialConnection | undefined;
    try {
      connection = await this.transport.open(path, BAUD_RATE);
      const session = await enterRawRepl(connection, PROBE_TIMEOUT_MS);
      session.exit();
      session.dispose();
      return true;
    } catch {
      return false;
    } finally {
      await connection?.close();
    }
  }

  async connect(deviceId: string): Promise<void> {
    const path = this.connectionPaths.get(deviceId);
    if (!path) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection = await this.transport.open(path, BAUD_RATE);
    const session = await enterRawRepl(connection, PROBE_TIMEOUT_MS);
    this.sessions.set(deviceId, { connection, session });
  }

  async disconnect(deviceId: string): Promise<void> {
    const entry = this.sessions.get(deviceId);
    if (!entry) return;
    entry.session.exit();
    entry.session.dispose();
    await entry.connection.close();
    this.sessions.delete(deviceId);
  }

  getCapabilities(_deviceId: string): CapabilityDescriptor[] {
    return createProjectCapabilities(this);
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    return handleProjectCapability(this, this.snapshotTransport, deviceId, this.kind, capabilityName, input);
  }

  getBackupType(): ProjectBackupType {
    return "source";
  }

  async listFiles(deviceId: string): Promise<ProjectFileEntry[]> {
    const session = this.requireSession(deviceId);
    const stdout = await session.exec(buildListFilesScript(), EXEC_TIMEOUT_MS);
    return parseListFilesOutput(stdout.toString("utf-8"));
  }

  async readFile(deviceId: string, path: string): Promise<string> {
    const session = this.requireSession(deviceId);
    const stdout = await session.exec(buildReadFileScript(path), EXEC_TIMEOUT_MS);
    return Buffer.from(stdout.toString("utf-8"), "base64").toString("utf-8");
  }

  async writeFile(deviceId: string, path: string, content: string): Promise<void> {
    const session = this.requireSession(deviceId);
    await session.exec(buildWriteFileScript(path, content), EXEC_TIMEOUT_MS);
  }

  private requireSession(deviceId: string): RawReplSession {
    const entry = this.sessions.get(deviceId);
    if (!entry) throw new Error(`Dispositivo no conectado: ${deviceId}`);
    return entry.session;
  }
}

export { enterRawRepl, RawReplExecError, RawReplTimeoutError, type RawReplSession } from "./rawRepl";
export { buildListFilesScript, buildReadFileScript, buildWriteFileScript, assertValidDevicePath } from "./snippets";
export { NodeRawSerialTransport } from "./infra/NodeRawSerialTransport";
export { FakeRawSerialTransport, FakeMicroPythonDevice, type FakeRawDevice } from "./infra/FakeRawSerialTransport";
export type { PortInfo, RawSerialConnection, RawSerialConnectionState, RawSerialTransportPort } from "./RawSerialTransportPort";
