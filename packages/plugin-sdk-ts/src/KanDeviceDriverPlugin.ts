import type {
  CapabilityDescriptor,
  CapabilityResult,
  DeviceDescriptor,
  DeviceDriverPort,
  TargetDescriptor,
} from "@kan/plugin-contract";
import { KanPlugin } from "./KanPlugin";

/**
 * Base para plugins de tipo "driver de dispositivo" (docs/04-arquitectura-plugins.md).
 * Un plugin concreto (simulador, ESP32, CNC...) solo implementa la lógica;
 * el Plugin Manager y el Device Manager del Edge Agent solo conocen este contrato.
 */
export abstract class KanDeviceDriverPlugin extends KanPlugin implements DeviceDriverPort {
  abstract readonly kind: string;

  abstract discover(): Promise<DeviceDescriptor[]>;
  abstract connect(deviceId: string): Promise<void>;
  abstract disconnect(deviceId: string): Promise<void>;
  abstract getCapabilities(deviceId: string): CapabilityDescriptor[];
  abstract invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult>;

  /**
   * Targets físicos direccionables conocidos de antemano (ej. los pines de
   * un ESP32), para que la Safety Policy del dispositivo tenga algo que
   * ofrecer al usuario para clasificar aunque ninguna capability se haya
   * invocado todavía. Vacío por defecto — la mayoría de los drivers (ej. el
   * simulador) no tienen targets configurables.
   */
  listTargets(_deviceId: string): TargetDescriptor[] {
    return [];
  }
}
