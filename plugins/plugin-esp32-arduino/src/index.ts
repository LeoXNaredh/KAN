import { access, constants as fsConstants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CapabilityDescriptor,
  CapabilityResult,
  DeviceDescriptor,
  IoMapEntry,
  PluginManifest,
  ProjectBackupType,
  ProjectDriverPort,
  ProjectFileEntry,
  SnapshotTransportPort,
  TargetDescriptor,
} from "@kan/plugin-contract";
import {
  createProjectCapabilities,
  defineCapability,
  definePermissions,
  handleProjectCapability,
  KanDeviceDriverPlugin,
  PROJECT_LIST_FILES,
  PROJECT_READ_FILE,
  PROJECT_RESTORE_SNAPSHOT,
  PROJECT_SAVE_SNAPSHOT,
} from "@kan/plugin-sdk-ts";
import { ESP32_PIN_MAP, defaultSeverityFor, findPin, type PinInfo } from "./pinMap";
import {
  NodeSerialTransport,
  NodeTcpTransport,
  type SerialTransportPort,
  type NetworkTransportPort,
  type LineConnection,
} from "@kan/serial-line-transport";
import { sendCommand, SerialTimeoutError, ConnectionNotReadyError } from "./wireProtocol";
import { SketchStore } from "./sketchStore";
import { NodeExternalProcess, runOrThrow, type ExternalProcessPort } from "./externalProcess";
import { readFlashImage, resolveFlashToolConfig, writeFlashImage } from "./binaryFlash";

const BAUD_RATE = 115200;
const PROBE_TIMEOUT_MS = 500;
const COMMAND_TIMEOUT_MS = 2000;
const EXPECTED_DEVICE_ID = "kan-esp32";
const DEFAULT_WIFI_PORT = 8266;
// docs/06 (backup/restore de proyecto), Plataforma B — timeouts generosos:
// compilar (con librerías) y flashear un chip son fundamentalmente más
// lentos que un comando GPIO.
const COMPILE_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const FLASH_READ_WRITE_TIMEOUT_MS = 120_000;
// Fallback de dev/tests — `apps/desktop` siempre pasa un `sketchesDir` real
// (dentro de userData, sobrevive reinicios); sin él, los sketches viven en
// el temp del SO (se pueden perder).
const DEFAULT_SKETCHES_DIR = join(tmpdir(), "kan-sketches");
const PROJECT_CAPABILITY_NAMES = new Set([PROJECT_LIST_FILES, PROJECT_READ_FILE, PROJECT_SAVE_SNAPSHOT, PROJECT_RESTORE_SNAPSHOT]);
const COMPILE_AND_UPLOAD = "compile_and_upload";

type ConnectionSource = { kind: "serial"; path: string } | { kind: "network"; host: string; port: number };

/** `KAN_ESP32_WIFI_HOSTS=192.168.1.50,192.168.1.51:9000` — puerto por defecto si se omite. */
function parseWifiHosts(envValue: string | undefined): Array<{ host: string; port: number }> {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, portText] = entry.split(":");
      const port = portText ? Number(portText) : DEFAULT_WIFI_PORT;
      return { host, port: Number.isFinite(port) ? port : DEFAULT_WIFI_PORT };
    });
}

type PinRequirement = "any" | "write" | "analogWrite";
type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function validatePin(input: unknown, requirement: PinRequirement): ValidationResult<PinInfo> {
  const pin = (input as { pin?: unknown } | null)?.pin;
  if (typeof pin !== "number" || !Number.isInteger(pin)) {
    return fail("'pin' debe ser un número entero");
  }
  const info = findPin(pin);
  if (!info) {
    return fail(`Pin desconocido o no usable: ${pin}`);
  }
  if (requirement === "write" && !info.canWrite) {
    return fail(`El pin ${pin} es solo-entrada, no admite escritura`);
  }
  if (requirement === "analogWrite" && !info.canAnalogWrite) {
    return fail(`El pin ${pin} no admite escritura analógica (PWM)`);
  }
  return ok(info);
}

function validateDigitalValue(input: unknown): ValidationResult<boolean> {
  const value = (input as { value?: unknown } | null)?.value;
  if (typeof value !== "boolean") {
    return fail("'value' debe ser boolean");
  }
  return ok(value);
}

function validateAnalogValue(input: unknown): ValidationResult<number> {
  const value = (input as { value?: unknown } | null)?.value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    return fail("'value' debe ser un entero entre 0 y 255");
  }
  return ok(value);
}

function sanitizeDeviceId(raw: string): string {
  return `esp32_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Primer driver de hardware físico real de KAN (requisito 15 del Edge
 * Agent, cumplido antes con el simulador). Nunca asume qué hay conectado a
 * un pin (regla 8 del sistema de Safety Policy, docs/00): expone GPIO
 * genérico y deja que `SafetyPolicyStore` (@kan/edge-agent-core) decida la
 * severidad efectiva por pin según cómo lo haya clasificado el usuario.
 *
 * Sin hardware disponible para probar en esta sesión — construido contra
 * `SerialTransportPort` para poder testear el protocolo y la validación con
 * `FakeSerialTransport` (ADR-012).
 */
export class Esp32ArduinoPlugin extends KanDeviceDriverPlugin implements ProjectDriverPort {
  readonly kind = "esp32-arduino";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-esp32-arduino",
    version: "0.1.0",
    displayName: "ESP32 / Arduino (GPIO genérico)",
    kind: "device-driver",
    runtime: "in-process-ts",
    // network: true — soporta WiFi/TCP (NodeTcpTransport), no solo Serial.
    permissions: definePermissions({ devices: ["esp32-arduino"], network: true, filesystem: [] }),
  };

  private readonly connectionSources = new Map<string, ConnectionSource>();
  private readonly connections = new Map<string, LineConnection>();
  /** `true` si el ping del firmware bridge de KAN respondió al descubrir este dispositivo — `undefined` (deviceId nunca visto) se trata como `true` para no cambiar el comportamiento de quien no usa el fallback de abajo. */
  private readonly bridgeStatus = new Map<string, boolean>();
  private readonly sketchStore: SketchStore;

  /**
   * `snapshotTransport` es opcional a propósito (a diferencia de
   * `MicroPythonPlugin`, que lo exige): este plugin sigue siendo útil solo
   * para GPIO sin él (uso histórico, Fase previa a docs/06) — sin
   * `snapshotTransport` configurado, `getCapabilities()` simplemente no
   * ofrece `project_*`/`compile_and_upload`, ningún comportamiento existente
   * cambia.
   */
  constructor(
    private readonly transport: SerialTransportPort = new NodeSerialTransport(),
    private readonly networkTransport: NetworkTransportPort = new NodeTcpTransport(),
    private readonly snapshotTransport?: SnapshotTransportPort,
    sketchesDir: string = DEFAULT_SKETCHES_DIR,
    private readonly externalProcess: ExternalProcessPort = new NodeExternalProcess(),
  ) {
    super();
    this.sketchStore = new SketchStore(sketchesDir);
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const found: DeviceDescriptor[] = [];

    const forcedPath = process.env.KAN_ESP32_PORT;
    const serialCandidates = forcedPath ? [forcedPath] : (await this.transport.list()).map((port) => port.path);
    for (const path of serialCandidates) {
      const isKanDevice = await this.probeConnection(() => this.transport.open(path, BAUD_RATE));
      // Sin firmware bridge, igual lo registramos SI el usuario forzó este
      // puerto a mano (KAN_ESP32_PORT) Y hay snapshotTransport configurado
      // (docs/06, Plataforma B): backup/restore de proyecto no necesita el
      // wire protocol propio de KAN, a diferencia de GPIO — es exactamente
      // el caso real de uso (un Arduino corriendo el sketch DEL USUARIO, no
      // el bridge). El escaneo automático (forcedPath ausente) sigue
      // exactamente como antes: nunca reclama un puerto que no confirmó ser
      // un dispositivo KAN.
      const registerWithoutBridge = !isKanDevice && forcedPath === path && this.snapshotTransport !== undefined;
      if (!isKanDevice && !registerWithoutBridge) continue;
      const deviceId = sanitizeDeviceId(`serial_${path}`);
      this.connectionSources.set(deviceId, { kind: "serial", path });
      this.bridgeStatus.set(deviceId, isKanDevice);
      const suffix = isKanDevice ? "" : ", sin firmware KAN — solo backup/restore de proyecto";
      found.push({ id: deviceId, name: `ESP32/Arduino (Serial ${path}${suffix})`, kind: this.kind });
    }

    // Nunca escanea la LAN entera — solo los hosts que el usuario configuró
    // explícitamente, mismo criterio pragmático que KAN_ESP32_PORT.
    const wifiCandidates = parseWifiHosts(process.env.KAN_ESP32_WIFI_HOSTS);
    for (const { host, port } of wifiCandidates) {
      const isKanDevice = await this.probeConnection(() => this.networkTransport.open(host, port));
      if (!isKanDevice) continue;
      const deviceId = sanitizeDeviceId(`wifi_${host}_${port}`);
      this.connectionSources.set(deviceId, { kind: "network", host, port });
      found.push({ id: deviceId, name: `ESP32/Arduino (WiFi ${host}:${port})`, kind: this.kind });
    }

    return found;
  }

  async connect(deviceId: string): Promise<void> {
    const source = this.connectionSources.get(deviceId);
    if (!source) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection =
      source.kind === "serial"
        ? await this.transport.open(source.path, BAUD_RATE)
        : await this.networkTransport.open(source.host, source.port);
    this.connections.set(deviceId, connection);
  }

  async disconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    await connection.close();
    this.connections.delete(deviceId);
  }

  getCapabilities(deviceId: string): CapabilityDescriptor[] {
    const hasBridge = this.bridgeStatus.get(deviceId) ?? true;
    const gpioCapabilities = hasBridge ? this.gpioCapabilities() : [];

    // project_*/compile_and_upload (docs/06, Plataforma B) necesitan un
    // puerto serial real (arduino-cli/esptool/avrdude no hablan por la
    // conexión WiFi de este plugin) — nunca se ofrecen para un dispositivo
    // conectado por WiFi, con o sin bridge.
    const source = this.connectionSources.get(deviceId);
    const supportsProject = this.snapshotTransport !== undefined && (source === undefined || source.kind === "serial");
    if (!supportsProject) return gpioCapabilities;

    return [
      ...gpioCapabilities,
      ...createProjectCapabilities(this),
      defineCapability({
        name: COMPILE_AND_UPLOAD,
        description:
          "Compila el sketch guardado para este dispositivo con arduino-cli y lo sube al chip. Requiere 'fqbn' (Fully Qualified Board Name, ej. \"esp32:esp32:esp32\") salvo que KAN_ESP32_FQBN esté configurado.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { fqbn: { type: "string" } } },
      }),
    ];
  }

  private gpioCapabilities(): CapabilityDescriptor[] {
    return [
      defineCapability({
        name: "read_digital_pin",
        description: "Lee el estado digital (HIGH/LOW) de un pin.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { pin: { type: "number" } },
          required: ["pin"],
        },
        targetParam: "pin",
      }),
      defineCapability({
        name: "read_analog_pin",
        description: "Lee el valor analógico (ADC) de un pin.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { pin: { type: "number" } },
          required: ["pin"],
        },
        targetParam: "pin",
      }),
      defineCapability({
        name: "write_digital_pin",
        description: "Escribe un estado digital (HIGH/LOW) en un pin.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { pin: { type: "number" }, value: { type: "boolean" } },
          required: ["pin", "value"],
        },
        targetParam: "pin",
      }),
      defineCapability({
        name: "write_analog_pin",
        description: "Escribe un valor PWM (0-255) en un pin.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { pin: { type: "number" }, value: { type: "number" } },
          required: ["pin", "value"],
        },
        targetParam: "pin",
      }),
      defineCapability({
        name: "discover_io_map",
        description:
          "Lee de una sola vez el estado de todos los pines conocidos del dispositivo (digital y analógico) — para reconocer de un vistazo un proyecto ya armado.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: {} },
      }),
    ];
  }

  listTargets(_deviceId: string): TargetDescriptor[] {
    return ESP32_PIN_MAP.map((pin) => ({
      target: String(pin.pin),
      defaultSeverity: defaultSeverityFor(pin),
    }));
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (capabilityName === COMPILE_AND_UPLOAD) {
      return this.compileAndUpload(deviceId, input);
    }
    if (this.snapshotTransport && PROJECT_CAPABILITY_NAMES.has(capabilityName)) {
      return handleProjectCapability(this, this.snapshotTransport, deviceId, this.kind, capabilityName, input);
    }

    const connection = this.connections.get(deviceId);
    if (!connection) {
      return { success: false, error: `Dispositivo no conectado: ${deviceId}` };
    }

    switch (capabilityName) {
      case "read_digital_pin": {
        const pin = validatePin(input, "any");
        if (!pin.ok) return { success: false, error: pin.error };
        return this.exchange(connection, { cmd: "read_digital", pin: pin.value.pin });
      }

      case "read_analog_pin": {
        const pin = validatePin(input, "any");
        if (!pin.ok) return { success: false, error: pin.error };
        return this.exchange(connection, { cmd: "read_analog", pin: pin.value.pin });
      }

      case "write_digital_pin": {
        const pin = validatePin(input, "write");
        if (!pin.ok) return { success: false, error: pin.error };
        const value = validateDigitalValue(input);
        if (!value.ok) return { success: false, error: value.error };
        return this.exchange(connection, { cmd: "write_digital", pin: pin.value.pin, value: value.value });
      }

      case "write_analog_pin": {
        const pin = validatePin(input, "analogWrite");
        if (!pin.ok) return { success: false, error: pin.error };
        const value = validateAnalogValue(input);
        if (!value.ok) return { success: false, error: value.error };
        return this.exchange(connection, { cmd: "write_analog", pin: pin.value.pin, value: value.value });
      }

      case "discover_io_map": {
        // Los pines input-only (34/35/36/39) son los únicos ADC reales del
        // mapa (ver comentario de INPUT_ONLY_PINS en pinMap.ts) — se reportan
        // como "analog". El resto se lee como "digital"; nunca se puede saber
        // si HOY están configurados como entrada o salida sin firmware nuevo
        // (ADR-058), así que su `mode` queda "unknown" a propósito.
        const digitalPins = ESP32_PIN_MAP.filter((p) => p.canWrite).map((p) => p.pin);
        const analogPins = ESP32_PIN_MAP.filter((p) => !p.canWrite).map((p) => p.pin);
        const result = await this.exchange(connection, { cmd: "read_all", digitalPins, analogPins });
        if (!result.success) return result;

        const data = result.data as { digital?: Record<string, number>; analog?: Record<string, number> };
        const entries: IoMapEntry[] = ESP32_PIN_MAP.map((pin) => {
          if (!pin.canWrite) {
            return {
              target: String(pin.pin),
              type: "analog",
              mode: "input",
              value: data.analog?.[String(pin.pin)] ?? null,
            };
          }
          return {
            target: String(pin.pin),
            type: "digital",
            mode: "unknown",
            value: data.digital?.[String(pin.pin)] === 1,
          };
        });
        return { success: true, data: { entries } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  // --- ProjectDriverPort (docs/06, Plataforma B) ---
  //
  // Nivel 1 (source): el .ino/las fuentes viven en `SketchStore`, local al
  // Edge Agent — no hay forma de leer código de vuelta desde el chip, a
  // diferencia de MicroPython. `getBackupType()` es solo el DEFAULT de
  // `project_save_snapshot` cuando no se pide un `backupType` explícito
  // (ver plugin-sdk-ts `handleProjectCapability`) — un mismo dispositivo
  // puede tener snapshots 'source' y 'binary' mezclados en el tiempo.
  //
  // Nivel 2 (binary): dump completo del flash vía esptool/avrdude
  // (`binaryFlash.ts`) — "restaurable pero no legible", como pide docs/06.

  getBackupType(): ProjectBackupType {
    return "source";
  }

  async listFiles(deviceId: string): Promise<ProjectFileEntry[]> {
    return this.sketchStore.listFiles(deviceId);
  }

  async readFile(deviceId: string, path: string): Promise<string> {
    return this.sketchStore.readFile(deviceId, path);
  }

  async writeFile(deviceId: string, path: string, content: string): Promise<void> {
    await this.sketchStore.writeFile(deviceId, path, content);
  }

  async readBinaryImage(deviceId: string): Promise<Buffer> {
    return this.withPortReleased(deviceId, (path) =>
      readFlashImage(this.externalProcess, resolveFlashToolConfig(path, FLASH_READ_WRITE_TIMEOUT_MS)),
    );
  }

  async writeBinaryImage(deviceId: string, image: Buffer): Promise<void> {
    await this.withPortReleased(deviceId, (path) =>
      writeFlashImage(this.externalProcess, resolveFlashToolConfig(path, FLASH_READ_WRITE_TIMEOUT_MS), image),
    );
  }

  /**
   * Compila el sketch guardado (`SketchStore`) y lo sube — capability propia
   * de este plugin, no parte de `ProjectDriverPort` (backup/restore no
   * necesita compilar nada; esto es la acción explícita "aplicá lo que
   * guardé", separada a propósito de `project_restore_snapshot`, que solo
   * escribe el archivo local sin tocar el chip).
   */
  private async compileAndUpload(deviceId: string, input: unknown): Promise<CapabilityResult> {
    const fqbnInput = (input as { fqbn?: unknown } | null)?.fqbn;
    const fqbn = typeof fqbnInput === "string" && fqbnInput.length > 0 ? fqbnInput : process.env.KAN_ESP32_FQBN;
    if (!fqbn) {
      return {
        success: false,
        error: "Falta 'fqbn' (ej. \"esp32:esp32:esp32\") y no hay KAN_ESP32_FQBN configurado para este Edge Agent.",
      };
    }

    const sketchPath = this.sketchStore.mainSketchPath(deviceId);
    const hasSketch = await access(sketchPath, fsConstants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (!hasSketch) {
      return {
        success: false,
        error: "No hay un sketch guardado para este dispositivo — restaurá un snapshot 'source' o guardá uno primero.",
      };
    }

    try {
      return await this.withPortReleased(deviceId, async (path) => {
        const sketchDir = this.sketchStore.sketchDir(deviceId);
        await runOrThrow(this.externalProcess, "arduino-cli", ["compile", "--fqbn", fqbn, sketchDir], {
          timeoutMs: COMPILE_TIMEOUT_MS,
        });
        await runOrThrow(this.externalProcess, "arduino-cli", ["upload", "--fqbn", fqbn, "--port", path, sketchDir], {
          timeoutMs: UPLOAD_TIMEOUT_MS,
        });
        return { success: true, data: { fqbn } };
      });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * `arduino-cli`/`esptool`/`avrdude` necesitan acceso exclusivo al puerto
   * serial — si KAN lo tiene abierto (bridge conectado, GPIO en uso), hay
   * que soltarlo antes de invocar la herramienta externa y sólo reabrirlo
   * después si había bridge (sin bridge, no hay wire protocol que
   * reconectar). Sin esto, compilar/subir/leer flash fallaría siempre que
   * el dispositivo estuviera "conectado" en KAN.
   */
  private async withPortReleased<T>(deviceId: string, fn: (path: string) => Promise<T>): Promise<T> {
    const source = this.connectionSources.get(deviceId);
    if (!source || source.kind !== "serial") {
      throw new Error(`Esta operación necesita una conexión serial real (dispositivo: ${deviceId}).`);
    }

    const connection = this.connections.get(deviceId);
    if (connection) {
      await connection.close();
      this.connections.delete(deviceId);
    }
    try {
      return await fn(source.path);
    } finally {
      if (connection && this.bridgeStatus.get(deviceId)) {
        this.connections.set(deviceId, await this.transport.open(source.path, BAUD_RATE));
      }
    }
  }

  /** Abre, manda un ping, cierra — nunca deja una conexión de sondeo abierta ni le escribe nada más a un puerto/host que no confirme ser un dispositivo KAN. */
  private async probeConnection(open: () => Promise<LineConnection>): Promise<boolean> {
    let connection: LineConnection | undefined;
    try {
      connection = await open();
      const response = await sendCommand(connection, { cmd: "ping" }, PROBE_TIMEOUT_MS);
      return response.ok === true && response.device === EXPECTED_DEVICE_ID;
    } catch {
      return false;
    } finally {
      await connection?.close();
    }
  }

  private async exchange(connection: LineConnection, command: Record<string, unknown>): Promise<CapabilityResult> {
    try {
      const response = await sendCommand(connection, command, COMMAND_TIMEOUT_MS);
      if (response.ok !== true) {
        return {
          success: false,
          error: typeof response.error === "string" ? response.error : "El dispositivo rechazó el comando",
        };
      }
      const { ok: _ignoredOkFlag, ...data } = response;
      return { success: true, data };
    } catch (error) {
      const message =
        error instanceof SerialTimeoutError || error instanceof ConnectionNotReadyError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return { success: false, error: message };
    }
  }
}

export { ESP32_PIN_MAP, findPin, defaultSeverityFor } from "./pinMap";
export type { PinInfo } from "./pinMap";
export type {
  SerialConnection,
  SerialTransportPort,
  PortInfo,
  LineConnection,
  LineConnectionState,
  NetworkTransportPort,
  TransportOptions,
  NodeTcpTransportTuning,
} from "@kan/serial-line-transport";
export { NodeSerialTransport, NodeTcpTransport } from "@kan/serial-line-transport";
export { FakeSerialTransport, type FakeDevice } from "./infra/FakeSerialTransport";
export { FakeNetworkTransport, type FakeNetworkDevice } from "./infra/FakeNetworkTransport";
export { ConnectionNotReadyError, SerialTimeoutError } from "./wireProtocol";
export { SketchStore } from "./sketchStore";
export { NodeExternalProcess, runOrThrow, type ExternalProcessPort, type ExternalProcessResult } from "./externalProcess";
export { FakeExternalProcess, type RecordedRun } from "./infra/FakeExternalProcess";
export { readFlashImage, writeFlashImage, resolveFlashToolConfig, type FlashTool, type FlashToolConfig } from "./binaryFlash";
