import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import { NodeSerialTransport, type LineConnection, type SerialTransportPort } from "@kan/serial-line-transport";
import { sendGcodeLine, type GcodeResponse } from "./gcodeProtocol";

const DEFAULT_BAUD_RATE = 115200;
const COMMAND_TIMEOUT_MS = 5000;
/** El homing puede tardar bastante — el mecanismo se mueve físicamente hasta el límite. */
const HOME_TIMEOUT_MS = 30_000;

const AXES = ["X", "Y", "Z"] as const;
type Axis = (typeof AXES)[number];

const TEMPERATURE_COMPONENTS = ["hotend", "bed"] as const;
type TemperatureComponent = (typeof TEMPERATURE_COMPONENTS)[number];

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

function sanitizeDeviceId(path: string): string {
  return `gcode_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/** `KAN_GCODE_PORTS=COM3,COM5` — nunca escanea puertos seriales sin configurar (ver README.md sobre por qué, a diferencia de ESP32). */
function parsePorts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
}

/**
 * Driver genérico de máquinas G-code (impresoras 3D tipo Marlin, CNC/láser
 * tipo GRBL) sobre Serial/USB. Mismo `DeviceDriverPort` que
 * `@kan/plugin-esp32-arduino`, reutilizando `@kan/serial-line-transport`
 * (extraído de ese plugin — mismo transporte, protocolo de cable distinto:
 * texto G-code en vez de JSON, ver gcodeProtocol.ts).
 *
 * A diferencia de ESP32 (que valida un handshake propio de KAN), no hay
 * forma universal de confirmar "esto es una máquina G-code de verdad" sin
 * asumir un firmware específico (Marlin y GRBL no comparten un comando de
 * identificación común) — por eso `discover()` no escanea puertos sin
 * configurar y solo confirma que el puerto configurado abre, ver
 * README.md. `emergency_stop`/`stop_spindle_or_laser` son `reversible`
 * (nunca deben quedar bloqueados detrás de una confirmación — parar debe
 * ser siempre la acción de menor fricción posible), mientras que
 * `start_spindle_or_laser` es `safety-critical`, el techo de severidad.
 */
export class GcodeDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "gcode";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-gcode",
    version: "0.1.0",
    displayName: "Máquina G-code (impresora 3D / CNC / láser)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["gcode"], network: false, filesystem: [] }),
  };

  private readonly ports = new Map<string, string>();
  private readonly connections = new Map<string, LineConnection>();

  constructor(
    private readonly transport: SerialTransportPort = new NodeSerialTransport(),
    private readonly baudRate: number = Number(process.env.KAN_GCODE_BAUD_RATE) || DEFAULT_BAUD_RATE,
  ) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const found: DeviceDescriptor[] = [];
    for (const path of parsePorts(process.env.KAN_GCODE_PORTS)) {
      let connection: LineConnection | undefined;
      try {
        connection = await this.transport.open(path, this.baudRate);
        const deviceId = sanitizeDeviceId(path);
        this.ports.set(deviceId, path);
        found.push({ id: deviceId, name: `Máquina G-code (Serial ${path})`, kind: this.kind });
      } catch {
        // Puerto configurado pero no disponible (ocupado, desconectado) — se omite.
      } finally {
        await connection?.close();
      }
    }
    return found;
  }

  async connect(deviceId: string): Promise<void> {
    const path = this.ports.get(deviceId);
    if (!path) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection = await this.transport.open(path, this.baudRate);
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
