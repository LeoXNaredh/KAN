import type { CapabilityDescriptor, CapabilityResult } from "./capability";

export interface DeviceDescriptor {
  id: string;
  name: string;
  kind: string;
}

/**
 * Contrato que implementa cualquier plugin de dispositivo (simulador hoy,
 * ESP32/CNC/impresoras después). Ni el Core ni el Edge Agent conocen el
 * detalle de un dispositivo concreto — solo hablan contra esta interfaz
 * (docs/06-arquitectura-dispositivos.md, sección 6).
 */
export interface DeviceDriverPort {
  readonly kind: string;
  discover(): Promise<DeviceDescriptor[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  getCapabilities(deviceId: string): CapabilityDescriptor[];
  invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult>;
}
