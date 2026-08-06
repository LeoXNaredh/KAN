import type { CapabilityDescriptor } from "@kan/plugin-contract";

export interface GlobalCapability {
  ref: string;
  edgeAgentId: string;
  deviceId: string;
  capability: CapabilityDescriptor;
}
