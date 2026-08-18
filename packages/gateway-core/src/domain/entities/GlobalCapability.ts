import type { CapabilityDescriptor } from "@kan/plugin-contract";

export interface GlobalCapability {
  ref: string;
  edgeAgentId: string;
  deviceId: string;
  /** Nombre humano del dispositivo (ej. "Motor del taller") — para reportar el resultado de una secuencia en lenguaje simple (kan_run_sequence), nunca el deviceId crudo. Cae a `deviceId` si el hello no lo trajo. */
  deviceName: string;
  capability: CapabilityDescriptor;
}
