import { readFileSync } from "node:fs";
import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability } from "@kan/plugin-sdk-ts";
import { RASPBERRY_PI_PIN_MAP, defaultSeverityFor, findPin } from "./pinMap";
import type { GpioDirection, GpioLine, GpioPort } from "./GpioPort";
import { OnoffGpioPort } from "./infra/OnoffGpioPort";

const DEVICE_ID = "raspberry-pi-gpio";
const DEVICE_TREE_MODEL_PATH = "/proc/device-tree/model";

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function validatePin(input: unknown): ValidationResult<{ pin: number }> {
  const pin = (input as { pin?: unknown } | null)?.pin;
  if (typeof pin !== "number" || !Number.isInteger(pin)) {
    return fail("'pin' debe ser un número entero");
  }
  const info = findPin(pin);
  if (!info) {
    return fail(`Pin desconocido o no usable: ${pin}`);
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

/**
 * `/proc/device-tree/model` es la forma estándar del kernel Linux de
 * identificar el modelo de placa — solo existe en sistemas ARM/Device Tree
 * (nunca en Windows/Mac), por eso el try/catch: en cualquier otra máquina
 * esto simplemente significa "no es una Pi", no un error a propagar.
 */
function isRunningOnRaspberryPi(): boolean {
  try {
    return readFileSync(DEVICE_TREE_MODEL_PATH, "utf8").includes("Raspberry Pi");
  } catch {
    return false;
  }
}

/**
 * Driver de GPIO nativo de Raspberry Pi (ADR-038) — a diferencia de
 * `Esp32ArduinoPlugin`, no hay dispositivo remoto ni protocolo de cable: el
 * "dispositivo" es la propia máquina donde corre el Edge Agent, así que solo
 * puede existir un `DEVICE_ID` fijo, nunca varios. Pensado para correr
 * `apps/desktop` en la propia Pi (docs/06: "la Pi puede correr su propio
 * mini Edge Agent").
 */
export class RaspberryPiGpioPlugin extends KanDeviceDriverPlugin {
  readonly kind = "raspberry-pi";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-raspberry-pi",
    version: "0.1.0",
    displayName: "Raspberry Pi (GPIO)",
    kind: "device-driver",
    runtime: "in-process-ts",
  };

  private readonly lines = new Map<number, { direction: GpioDirection; line: GpioLine }>();

  constructor(
    private readonly gpioPort: GpioPort = new OnoffGpioPort(),
    // Inyectable a propósito: permite testear discover() en cualquier
    // máquina (los tests no corren en una Pi real) sin tocar el filesystem.
    private readonly detectRaspberryPi: () => boolean = isRunningOnRaspberryPi,
  ) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    if (!this.detectRaspberryPi() || !this.gpioPort.isAccessible()) return [];
    return [{ id: DEVICE_ID, name: "Raspberry Pi (GPIO)", kind: this.kind }];
  }

  async connect(deviceId: string): Promise<void> {
    if (deviceId !== DEVICE_ID) throw new Error(`Dispositivo desconocido: ${deviceId}`);
  }

  async disconnect(deviceId: string): Promise<void> {
    if (deviceId !== DEVICE_ID) return;
    for (const { line } of this.lines.values()) await line.close();
    this.lines.clear();
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "read_digital_pin",
        description: "Lee el estado digital (HIGH/LOW) de un pin GPIO.",
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
        description: "Escribe un estado digital (HIGH/LOW) en un pin GPIO.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { pin: { type: "number" }, value: { type: "boolean" } },
          required: ["pin", "value"],
        },
        targetParam: "pin",
      }),
    ];
  }

  listTargets(_deviceId: string): TargetDescriptor[] {
    return RASPBERRY_PI_PIN_MAP.map((pin) => ({
      target: String(pin.pin),
      defaultSeverity: defaultSeverityFor(pin),
    }));
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (deviceId !== DEVICE_ID) {
      return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    }

    switch (capabilityName) {
      case "read_digital_pin": {
        const pin = validatePin(input);
        if (!pin.ok) return { success: false, error: pin.error };
        const line = await this.getOrOpenLine(pin.value.pin, "in");
        const value = await line.read();
        return { success: true, data: { pin: pin.value.pin, value } };
      }

      case "write_digital_pin": {
        const pin = validatePin(input);
        if (!pin.ok) return { success: false, error: pin.error };
        const value = validateDigitalValue(input);
        if (!value.ok) return { success: false, error: value.error };
        const line = await this.getOrOpenLine(pin.value.pin, "out");
        await line.write(value.value);
        return { success: true, data: { pin: pin.value.pin, value: value.value } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  /** `onoff` exporta un pin con una dirección fija — si un pin ya estaba abierto con la otra dirección, se cierra y se reabre. */
  private async getOrOpenLine(pin: number, direction: GpioDirection): Promise<GpioLine> {
    const existing = this.lines.get(pin);
    if (existing && existing.direction === direction) return existing.line;
    if (existing) await existing.line.close();

    const line = this.gpioPort.open(pin, direction);
    this.lines.set(pin, { direction, line });
    return line;
  }
}

export { RASPBERRY_PI_PIN_MAP, findPin, defaultSeverityFor } from "./pinMap";
export type { PinInfo } from "./pinMap";
export type { GpioDirection, GpioLine, GpioPort } from "./GpioPort";
export { OnoffGpioPort } from "./infra/OnoffGpioPort";
export { FakeGpioPort } from "./infra/FakeGpioPort";
