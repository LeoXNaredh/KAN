import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import {
  NodeSerialTransport,
  NodeTcpTransport,
  type LineConnection,
  type NetworkTransportPort,
  type SerialTransportPort,
} from "@kan/serial-line-transport";
import { sendGcodeLine, type GcodeResponse } from "./gcodeProtocol";

const DEFAULT_BAUD_RATE = 115200;
const COMMAND_TIMEOUT_MS = 5000;
/** El homing puede tardar bastante — el mecanismo se mueve físicamente hasta el límite. */
const HOME_TIMEOUT_MS = 30_000;
/** Límite en el borde (mismo criterio que MAX_IMAGE_BYTES en /api/chat, P3) — evita que un G-code descomunal quede colgado en memoria. */
const MAX_GCODE_CHARS = 2_000_000;

const AXES = ["X", "Y", "Z"] as const;
type Axis = (typeof AXES)[number];

const TEMPERATURE_COMPONENTS = ["hotend", "bed"] as const;
type TemperatureComponent = (typeof TEMPERATURE_COMPONENTS)[number];

type ConnectionSource = { kind: "serial"; path: string } | { kind: "network"; host: string; port: number };

type PrintJobStatus = "printing" | "paused";

interface PrintJob {
  lines: string[];
  currentIndex: number;
  status: PrintJobStatus;
  filename?: string;
  lastError?: string;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function validateAxis(input: unknown): ValidationResult<Axis> {
  const raw = (input as { axis?: unknown } | null)?.axis;
  const axis = typeof raw === "string" ? raw.toUpperCase() : undefined;
  if (!axis || !(AXES as readonly string[]).includes(axis)) {
    return fail(`'axis' debe ser uno de: ${AXES.join(", ")}`);
  }
  return ok(axis as Axis);
}

function validateDistance(input: unknown): ValidationResult<number> {
  const distanceMm = (input as { distanceMm?: unknown } | null)?.distanceMm;
  if (typeof distanceMm !== "number" || !Number.isFinite(distanceMm)) {
    return fail("'distanceMm' debe ser un número");
  }
  return ok(distanceMm);
}

function validateOptionalFeedRate(input: unknown): ValidationResult<number | undefined> {
  const feedRateMmPerMin = (input as { feedRateMmPerMin?: unknown } | null)?.feedRateMmPerMin;
  if (feedRateMmPerMin === undefined) return ok(undefined);
  if (typeof feedRateMmPerMin !== "number" || feedRateMmPerMin <= 0) {
    return fail("'feedRateMmPerMin' debe ser un número positivo");
  }
  return ok(feedRateMmPerMin);
}

function validateComponent(input: unknown): ValidationResult<TemperatureComponent> {
  const component = (input as { component?: unknown } | null)?.component;
  if (component !== "hotend" && component !== "bed") {
    return fail(`'component' debe ser uno de: ${TEMPERATURE_COMPONENTS.join(", ")}`);
  }
  return ok(component);
}

function validateCelsius(input: unknown): ValidationResult<number> {
  const celsius = (input as { celsius?: unknown } | null)?.celsius;
  if (typeof celsius !== "number" || !Number.isFinite(celsius) || celsius < 0) {
    return fail("'celsius' debe ser un número >= 0");
  }
  return ok(celsius);
}

function validateAxesList(input: unknown): ValidationResult<string | undefined> {
  const axes = (input as { axes?: unknown } | null)?.axes;
  if (axes === undefined) return ok(undefined);
  if (typeof axes !== "string" || !axes.trim()) {
    return fail("'axes' debe ser un string no vacío si se especifica (ej. 'X Y')");
  }
  return ok(axes.trim().toUpperCase());
}

function validateDirection(input: unknown): ValidationResult<"cw" | "ccw"> {
  const direction = (input as { direction?: unknown } | null)?.direction;
  if (direction === undefined) return ok("cw");
  if (direction !== "cw" && direction !== "ccw") return fail("'direction' debe ser 'cw' o 'ccw'");
  return ok(direction);
}

function validatePower(input: unknown): ValidationResult<number | undefined> {
  const power = (input as { power?: unknown } | null)?.power;
  if (power === undefined) return ok(undefined);
  if (typeof power !== "number" || power < 0) return fail("'power' debe ser un número >= 0");
  return ok(power);
}

function validateRawLine(input: unknown): ValidationResult<string> {
  const line = (input as { line?: unknown } | null)?.line;
  if (typeof line !== "string" || !line.trim()) return fail("'line' debe ser un string no vacío");
  return ok(line.trim());
}

function validatePrintFile(input: unknown): ValidationResult<{ gcode: string; filename?: string }> {
  const gcode = (input as { gcode?: unknown } | null)?.gcode;
  if (typeof gcode !== "string" || !gcode.trim()) return fail("'gcode' debe ser un string no vacío");
  if (gcode.length > MAX_GCODE_CHARS) {
    return fail(`El G-code supera el límite de ${MAX_GCODE_CHARS.toLocaleString()} caracteres.`);
  }
  const filename = (input as { filename?: unknown } | null)?.filename;
  if (filename !== undefined && typeof filename !== "string") {
    return fail("'filename' debe ser un string si se especifica");
  }
  return ok({ gcode, filename });
}

/** Descarta comentarios (';...') y líneas vacías resultantes — mismo criterio que cualquier host de G-code (Cura/OctoPrint) para no gastar round-trips en líneas sin comando real. */
function extractGcodeLines(gcode: string): string[] {
  return gcode
    .split(/\r?\n/)
    .map((line) => line.replace(/;.*/, "").trim())
    .filter((line) => line.length > 0);
}

/** Parsea la respuesta de M105 ("T:<actual>/<target> B:<actual>/<target> ..."). `null` por componente si el firmware no lo reportó (ej. sin cama caliente). */
function parseTemperatures(lines: string[]): {
  hotend: { current: number; target: number } | null;
  bed: { current: number; target: number } | null;
} {
  const text = lines.join(" ");
  const hotendMatch = /(?:^|\s)T:([\d.]+)\s*\/\s*([\d.]+)/.exec(text);
  const bedMatch = /(?:^|\s)B:([\d.]+)\s*\/\s*([\d.]+)/.exec(text);
  return {
    hotend: hotendMatch ? { current: Number(hotendMatch[1]), target: Number(hotendMatch[2]) } : null,
    bed: bedMatch ? { current: Number(bedMatch[1]), target: Number(bedMatch[2]) } : null,
  };
}

function summarizeJob(job: PrintJob) {
  return {
    status: job.status,
    currentLine: job.currentIndex,
    totalLines: job.lines.length,
    percent: job.lines.length ? Math.round((job.currentIndex / job.lines.length) * 100) : 0,
    filename: job.filename,
    lastError: job.lastError,
  };
}

function sanitizeDeviceId(raw: string): string {
  return `gcode_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * `KAN_GCODE_SERIAL_PORT=COM3` (un solo puerto — no escanea, ver README.md
 * sobre por qué, a diferencia de ESP32) y/o `KAN_GCODE_WIFI_HOST` +
 * `KAN_GCODE_WIFI_PORT` (host/puerto de un bridge serial-a-red — sin default
 * asumido, ninguno es estándar entre firmwares/bridges a diferencia del 8266
 * del propio firmware de ESP32). Ambos pueden coexistir — hasta dos
 * dispositivos, uno por transporte.
 */
function serialPortFromEnv(): string | undefined {
  const path = process.env.KAN_GCODE_SERIAL_PORT;
  return path?.trim() || undefined;
}

function wifiTargetFromEnv(): { host: string; port: number } | undefined {
  const host = process.env.KAN_GCODE_WIFI_HOST?.trim();
  if (!host) return undefined;
  const port = Number(process.env.KAN_GCODE_WIFI_PORT);
  if (!Number.isFinite(port) || port <= 0) return undefined;
  return { host, port };
}

/**
 * Driver genérico de máquinas G-code (impresoras 3D tipo Marlin, CNC/láser
 * tipo GRBL) sobre Serial/USB o WiFi/TCP (bridge serial-a-red). Mismo
 * `DeviceDriverPort` que `@kan/plugin-esp32-arduino`, reutilizando
 * `@kan/serial-line-transport` (transporte serial y de red, ambos extraídos
 * de ese plugin — mismo transporte, protocolo de cable distinto: texto
 * G-code en vez de JSON, ver gcodeProtocol.ts).
 *
 * A diferencia de ESP32 (que valida un handshake propio de KAN), no hay
 * forma universal de confirmar "esto es una máquina G-code de verdad" sin
 * asumir un firmware específico (Marlin y GRBL no comparten un comando de
 * identificación común) — por eso `discover()` no escanea puertos/hosts sin
 * configurar y solo confirma que la conexión abre, ver README.md.
 * `emergency_stop`/`stop_spindle_or_laser`/`pause_print` son `reversible`
 * (nunca deben quedar bloqueados detrás de una confirmación — parar debe
 * ser siempre la acción de menor fricción posible), mientras que
 * `start_spindle_or_laser` es `safety-critical`, el techo de severidad.
 *
 * Control de impresión (P9, ADR-043): `print_file` transmite el G-code
 * línea por línea por el mismo cable serial/red (streaming, "modo host" —
 * igual que OctoPrint/Cura/Pronterface por defecto), no vía SD de la
 * impresora — evita una máquina de estados de escritura a SD nueva y
 * funciona en impresoras sin SD. El progreso lo lleva el propio driver
 * (líneas enviadas/total), no depende de que el firmware lo reporte bien.
 * El estado del job vive solo en memoria — un reinicio del Edge Agent en
 * medio de una impresión pierde el tracking (la impresora sigue haciendo lo
 * que ya se le mandó, pero KAN deja de saber en qué línea iba).
 */
export class GcodeDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "gcode";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-gcode",
    version: "0.1.0",
    displayName: "Máquina G-code (impresora 3D / CNC / láser)",
    kind: "device-driver",
    runtime: "in-process-ts",
    // network: true — soporta WiFi/TCP (bridge serial-a-red), no solo Serial.
    permissions: definePermissions({ devices: ["gcode"], network: true, filesystem: [] }),
  };

  private readonly connectionSources = new Map<string, ConnectionSource>();
  private readonly connections = new Map<string, LineConnection>();
  private readonly printJobs = new Map<string, PrintJob>();

  constructor(
    private readonly transport: SerialTransportPort = new NodeSerialTransport(),
    private readonly networkTransport: NetworkTransportPort = new NodeTcpTransport(),
    private readonly baudRate: number = Number(process.env.KAN_GCODE_BAUD_RATE) || DEFAULT_BAUD_RATE,
  ) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const found: DeviceDescriptor[] = [];

    const serialPath = serialPortFromEnv();
    if (serialPath) {
      let connection: LineConnection | undefined;
      try {
        connection = await this.transport.open(serialPath, this.baudRate);
        const deviceId = sanitizeDeviceId(`serial_${serialPath}`);
        this.connectionSources.set(deviceId, { kind: "serial", path: serialPath });
        found.push({ id: deviceId, name: `Máquina G-code (Serial ${serialPath})`, kind: this.kind });
      } catch {
        // Puerto configurado pero no disponible (ocupado, desconectado) — se omite.
      } finally {
        await connection?.close();
      }
    }

    const wifiTarget = wifiTargetFromEnv();
    if (wifiTarget) {
      let connection: LineConnection | undefined;
      try {
        connection = await this.networkTransport.open(wifiTarget.host, wifiTarget.port);
        const deviceId = sanitizeDeviceId(`wifi_${wifiTarget.host}_${wifiTarget.port}`);
        this.connectionSources.set(deviceId, { kind: "network", host: wifiTarget.host, port: wifiTarget.port });
        found.push({
          id: deviceId,
          name: `Máquina G-code (WiFi ${wifiTarget.host}:${wifiTarget.port})`,
          kind: this.kind,
        });
      } catch {
        // Host/puerto configurado pero inalcanzable — se omite.
      } finally {
        await connection?.close();
      }
    }

    return found;
  }

  async connect(deviceId: string): Promise<void> {
    const source = this.connectionSources.get(deviceId);
    if (!source) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection =
      source.kind === "serial"
        ? await this.transport.open(source.path, this.baudRate)
        : await this.networkTransport.open(source.host, source.port);
    this.connections.set(deviceId, connection);
  }

  async disconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    await connection.close();
    this.connections.delete(deviceId);
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "home_axes",
        description: "Homea todos los ejes o los que se especifiquen (G28).",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { axes: { type: "string" } },
        },
      }),
      defineCapability({
        name: "move_axis",
        description: "Mueve un eje una distancia relativa en milímetros (G91/G0/G90).",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: {
            axis: { type: "string" },
            distanceMm: { type: "number" },
            feedRateMmPerMin: { type: "number" },
          },
          required: ["axis", "distanceMm"],
        },
        targetParam: "axis",
      }),
      defineCapability({
        name: "set_temperature",
        description: "Fija la temperatura objetivo del hotend o la cama, sin esperar a que la alcance (M104/M140).",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { component: { type: "string" }, celsius: { type: "number" } },
          required: ["component", "celsius"],
        },
        targetParam: "component",
      }),
      defineCapability({
        name: "get_position",
        description: "Devuelve la posición actual reportada por la máquina (M114).",
        severity: "read-only",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "get_status",
        description: "Temperaturas actuales (M105) y estado de la impresión en curso, si hay una.",
        severity: "read-only",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "print_file",
        description: "Transmite un G-code línea por línea y empieza a imprimir (streaming directo, no usa la SD de la impresora).",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { gcode: { type: "string" }, filename: { type: "string" } },
          required: ["gcode"],
        },
      }),
      defineCapability({
        name: "pause_print",
        description: "Pausa la impresión en curso — deja de mandar líneas nuevas, no toca la máquina.",
        severity: "reversible",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "resume_print",
        description: "Reanuda una impresión pausada desde donde quedó.",
        severity: "irreversible-material",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "cancel_print",
        description: "Cancela la impresión en curso — deja de mandar líneas nuevas, no homea ni apaga temperaturas.",
        severity: "reversible",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "start_spindle_or_laser",
        description: "Enciende el spindle o láser (M3/M4) — acción de máxima severidad, podría causar daño físico real.",
        severity: "safety-critical",
        supportsDryRun: false,
        // Ambos campos opcionales: 'direction' cae a "cw" y 'power' se omite
        // del comando si no se especifica (ver validateDirection/validatePower).
        inputSchema: {
          type: "object",
          properties: { direction: { type: "string" }, power: { type: "number" } },
        },
      }),
      defineCapability({
        name: "stop_spindle_or_laser",
        description: "Apaga el spindle o láser (M5).",
        severity: "reversible",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "emergency_stop",
        description: "Parada de emergencia (M112) — detiene la máquina de inmediato. Algunos firmwares (Marlin) requieren reiniciar tras esto.",
        severity: "reversible",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "send_raw_gcode",
        description: "Envía una línea G-code arbitraria — para comandos no cubiertos por las capabilities estructuradas.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { line: { type: "string" } },
          required: ["line"],
        },
      }),
    ];
  }

  listTargets(_deviceId: string): TargetDescriptor[] {
    return [
      ...AXES.map((axis) => ({ target: axis, defaultSeverity: "irreversible-material" as const })),
      ...TEMPERATURE_COMPONENTS.map((component) => ({ target: component, defaultSeverity: "irreversible-material" as const })),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return { success: false, error: `Dispositivo no conectado: ${deviceId}` };
    }

    switch (capabilityName) {
      case "home_axes": {
        const axes = validateAxesList(input);
        if (!axes.ok) return { success: false, error: axes.error };
        const line = axes.value ? `G28 ${axes.value}` : "G28";
        return this.exchange(connection, [line], HOME_TIMEOUT_MS);
      }

      case "move_axis": {
        const axis = validateAxis(input);
        if (!axis.ok) return { success: false, error: axis.error };
        const distance = validateDistance(input);
        if (!distance.ok) return { success: false, error: distance.error };
        const feedRate = validateOptionalFeedRate(input);
        if (!feedRate.ok) return { success: false, error: feedRate.error };

        const feedSuffix = feedRate.value !== undefined ? ` F${feedRate.value}` : "";
        return this.exchange(
          connection,
          ["G91", `G0 ${axis.value}${distance.value}${feedSuffix}`, "G90"],
          COMMAND_TIMEOUT_MS,
        );
      }

      case "set_temperature": {
        const component = validateComponent(input);
        if (!component.ok) return { success: false, error: component.error };
        const celsius = validateCelsius(input);
        if (!celsius.ok) return { success: false, error: celsius.error };

        const gcode = component.value === "hotend" ? "M104" : "M140";
        return this.exchange(connection, [`${gcode} S${celsius.value}`], COMMAND_TIMEOUT_MS);
      }

      case "get_position":
        return this.exchange(connection, ["M114"], COMMAND_TIMEOUT_MS);

      case "get_status": {
        const tempResult = await this.exchange(connection, ["M105"], COMMAND_TIMEOUT_MS);
        if (!tempResult.success) return tempResult;
        const responseLines = (tempResult.data as { response?: string[] } | undefined)?.response ?? [];
        const job = this.printJobs.get(deviceId);
        return {
          success: true,
          data: {
            temperatures: parseTemperatures(responseLines),
            job: job ? summarizeJob(job) : null,
          },
        };
      }

      case "print_file": {
        const parsed = validatePrintFile(input);
        if (!parsed.ok) return { success: false, error: parsed.error };
        if (this.printJobs.has(deviceId)) {
          return {
            success: false,
            error: "Ya hay una impresión en curso en este dispositivo — cancelala antes de iniciar otra.",
          };
        }
        const lines = extractGcodeLines(parsed.value.gcode);
        if (lines.length === 0) {
          return { success: false, error: "El G-code no tiene ninguna línea válida para enviar." };
        }
        const job: PrintJob = { lines, currentIndex: 0, status: "printing", filename: parsed.value.filename };
        this.printJobs.set(deviceId, job);
        void this.runPrintLoop(deviceId, connection);
        return { success: true, data: { totalLines: lines.length, filename: job.filename } };
      }

      case "pause_print": {
        const job = this.printJobs.get(deviceId);
        if (!job) return { success: false, error: "No hay ninguna impresión en curso en este dispositivo." };
        if (job.status !== "printing") {
          return { success: false, error: `La impresión ya está en estado "${job.status}".` };
        }
        job.status = "paused";
        return { success: true, data: summarizeJob(job) };
      }

      case "resume_print": {
        const job = this.printJobs.get(deviceId);
        if (!job) return { success: false, error: "No hay ninguna impresión en curso en este dispositivo." };
        if (job.status !== "paused") {
          return { success: false, error: `La impresión no está pausada (estado: "${job.status}").` };
        }
        job.status = "printing";
        void this.runPrintLoop(deviceId, connection);
        return { success: true, data: summarizeJob(job) };
      }

      case "cancel_print": {
        const job = this.printJobs.get(deviceId);
        if (!job) return { success: false, error: "No hay ninguna impresión en curso en este dispositivo." };
        this.printJobs.delete(deviceId);
        return { success: true, data: { cancelledAtLine: job.currentIndex, totalLines: job.lines.length } };
      }

      case "start_spindle_or_laser": {
        const direction = validateDirection(input);
        if (!direction.ok) return { success: false, error: direction.error };
        const power = validatePower(input);
        if (!power.ok) return { success: false, error: power.error };

        const gcode = direction.value === "ccw" ? "M4" : "M3";
        const line = power.value !== undefined ? `${gcode} S${power.value}` : gcode;
        return this.exchange(connection, [line], COMMAND_TIMEOUT_MS);
      }

      case "stop_spindle_or_laser":
        return this.exchange(connection, ["M5"], COMMAND_TIMEOUT_MS);

      case "emergency_stop":
        return this.exchange(connection, ["M112"], COMMAND_TIMEOUT_MS);

      case "send_raw_gcode": {
        const line = validateRawLine(input);
        if (!line.ok) return { success: false, error: line.error };
        return this.exchange(connection, [line.value], COMMAND_TIMEOUT_MS);
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  /**
   * Loop de streaming de un print_file — re-lee `this.printJobs` en cada
   * vuelta (no una referencia capturada al arrancar) para que
   * pause_print/cancel_print, que mutan/borran esa misma entrada desde
   * `invoke()`, se noten de inmediato sin coordinación adicional.
   */
  private async runPrintLoop(deviceId: string, connection: LineConnection): Promise<void> {
    for (;;) {
      const job = this.printJobs.get(deviceId);
      if (!job || job.status !== "printing") return;
      if (job.currentIndex >= job.lines.length) {
        this.printJobs.delete(deviceId);
        return;
      }

      const line = job.lines[job.currentIndex];
      try {
        await sendGcodeLine(connection, line, COMMAND_TIMEOUT_MS);
        job.currentIndex += 1;
      } catch (error) {
        job.status = "paused";
        job.lastError = error instanceof Error ? error.message : String(error);
        return;
      }
    }
  }

  /** Manda una o más líneas en secuencia, se detiene en el primer error — nunca deja una excepción sin manejar. */
  private async exchange(connection: LineConnection, lines: string[], timeoutMs: number): Promise<CapabilityResult> {
    try {
      let response: GcodeResponse = { lines: [] };
      for (const line of lines) {
        response = await sendGcodeLine(connection, line, timeoutMs);
      }
      return { success: true, data: response.lines.length ? { response: response.lines } : {} };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export { sendGcodeLine, GcodeTimeoutError, ConnectionNotReadyError, type GcodeResponse } from "./gcodeProtocol";
export { FakeGcodeSerialTransport, type FakeGcodeDevice } from "./infra/FakeGcodeSerialTransport";
export { FakeGcodeNetworkTransport, type FakeGcodeNetworkDevice } from "./infra/FakeGcodeNetworkTransport";
