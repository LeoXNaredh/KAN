import type {
  CapabilityResult,
  DeviceDescriptor,
  PluginManifest,
} from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability } from "@kan/plugin-sdk-ts";

const DEVICE_ID = "simulator-1";

interface SimulatedState {
  ledOn: boolean;
  axisPositionMm: number;
}

/**
 * Primer "dispositivo" del Edge Agent (requisito 15). Se comporta igual que
 * un driver real (mismo DeviceDriverPort), con tres capabilities de
 * severidad distinta para ejercitar todo el Permission Manager antes de
 * conectar hardware de verdad (ESP32, CNC, impresoras...).
 */
export class DeviceSimulatorPlugin extends KanDeviceDriverPlugin {
  readonly kind = "device-simulator";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-device-simulator",
    version: "0.1.0",
    displayName: "Simulador de Dispositivo",
    kind: "device-driver",
    runtime: "in-process-ts",
  };

  private readonly state: SimulatedState = { ledOn: false, axisPositionMm: 0 };

  async discover(): Promise<DeviceDescriptor[]> {
    return [{ id: DEVICE_ID, name: "Dispositivo Simulado #1", kind: this.kind }];
  }

  async connect(_deviceId: string): Promise<void> {
    // No hay hardware real que abrir; el estado ya vive en memoria.
  }

  async disconnect(_deviceId: string): Promise<void> {
    // Nada que cerrar.
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "read_sensor",
        description: "Lee un valor de temperatura simulado.",
        severity: "read-only",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "toggle_led",
        description: "Enciende o apaga el LED simulado.",
        severity: "reversible",
        supportsDryRun: false,
        inputSchema: { on: "boolean" },
      }),
      defineCapability({
        name: "move_axis",
        description: "Mueve el eje simulado una distancia en milímetros.",
        severity: "irreversible-material",
        supportsDryRun: true,
        inputSchema: { distanceMm: "number" },
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (deviceId !== DEVICE_ID) {
      return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    }

    switch (capabilityName) {
      case "read_sensor":
        return { success: true, data: { temperatureC: 20 + Math.random() * 5 } };

      case "toggle_led": {
        const on = (input as { on?: unknown } | undefined)?.on;
        if (typeof on !== "boolean") {
          return { success: false, error: "'on' debe ser boolean" };
        }
        this.state.ledOn = on;
        return { success: true, data: { ledOn: this.state.ledOn } };
      }

      case "move_axis": {
        const distanceMm = (input as { distanceMm?: unknown } | undefined)?.distanceMm;
        if (typeof distanceMm !== "number" || !Number.isFinite(distanceMm)) {
          return { success: false, error: "'distanceMm' debe ser un número finito" };
        }
        this.state.axisPositionMm += distanceMm;
        return { success: true, data: { axisPositionMm: this.state.axisPositionMm } };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }
}
