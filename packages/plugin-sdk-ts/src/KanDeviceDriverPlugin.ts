import type {
  CapabilityDescriptor,
  CapabilityResult,
  DeviceDescriptor,
  DeviceDriverPort,
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
}
