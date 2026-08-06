import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability } from "@kan/plugin-sdk-ts";
import { ESP32_PIN_MAP, defaultSeverityFor, findPin, type PinInfo } from "./pinMap";
import { NodeSerialTransport } from "./infra/NodeSerialTransport";
import type { SerialConnection, SerialTransportPort } from "./SerialTransportPort";
import { sendCommand, SerialTimeoutError } from "./wireProtocol";

const BAUD_RATE = 115200;
const PROBE_TIMEOUT_MS = 500;
const COMMAND_TIMEOUT_MS = 2000;
const EXPECTED_DEVICE_ID = "kan-esp32";

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

function sanitizeDeviceId(path: string): string {
  return `esp32_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
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
export class Esp32ArduinoPlugin extends KanDeviceDriverPlugin {
  readonly kind = "esp32-arduino";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-esp32-arduino",
    version: "0.1.0",
    displayName: "ESP32 / Arduino (GPIO genérico)",
    kind: "device-driver",
    runtime: "in-process-ts",
  };

  private readonly devicePaths = new Map<string, string>();
  private readonly connections = new Map<string, SerialConnection>();

  constructor(private readonly transport: SerialTransportPort = new NodeSerialTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const forcedPath = process.env.KAN_ESP32_PORT;
    const candidatePaths = forcedPath ? [forcedPath] : (await this.transport.list()).map((port) => port.path);

    const found: DeviceDescriptor[] = [];
    for (const path of candidatePaths) {
      const isKanDevice = await this.probe(path);
      if (!isKanDevice) continue;
      const deviceId = sanitizeDeviceId(path);
      this.devicePaths.set(deviceId, path);
      found.push({ id: deviceId, name: `ESP32/Arduino (${path})`, kind: this.kind });
    }
    return found;
  }

  async connect(deviceId: string): Promise<void> {
    const path = this.devicePaths.get(deviceId);
    if (!path) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const connection = await this.transport.open(path, BAUD_RATE);
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
        name: "read_digital_pin",
        description: "Lee el estado digital (HIGH/LOW) de un pin.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { pin: "number" },
        targetParam: "pin",
      }),
      defineCapability({
        name: "read_analog_pin",
        description: "Lee el valor analógico (ADC) de un pin.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { pin: "number" },
        targetParam: "pin",
      }),
      defineCapability({
        name: "write_digital_pin",
        description: "Escribe un estado digital (HIGH/LOW) en un pin.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: { pin: "number", value: "boolean" },
        targetParam: "pin",
      }),
      defineCapability({
        name: "write_analog_pin",
        description: "Escribe un valor PWM (0-255) en un pin.",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: { pin: "number", value: "number" },
        targetParam: "pin",
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

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private async probe(path: string): Promise<boolean> {
    let connection: SerialConnection | undefined;
    try {
      connection = await this.transport.open(path, BAUD_RATE);
      const response = await sendCommand(connection, { cmd: "ping" }, PROBE_TIMEOUT_MS);
      return response.ok === true && response.device === EXPECTED_DEVICE_ID;
    } catch {
      return false;
    } finally {
      await connection?.close();
    }
  }

  private async exchange(connection: SerialConnection, command: Record<string, unknown>): Promise<CapabilityResult> {
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
        error instanceof SerialTimeoutError ? error.message : error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}

export { ESP32_PIN_MAP, findPin, defaultSeverityFor } from "./pinMap";
export type { PinInfo } from "./pinMap";
export type { SerialConnection, SerialTransportPort, PortInfo } from "./SerialTransportPort";
export { NodeSerialTransport } from "./infra/NodeSerialTransport";
export { FakeSerialTransport, type FakeDevice } from "./infra/FakeSerialTransport";
