import type { CapabilityDescriptor } from "@kan/plugin-contract";

export type DeviceStatus = "connected" | "disconnected" | "error";

export interface Device {
  id: string;
  name: string;
  kind: string;
  pluginId: string;
  status: DeviceStatus;
  capabilities: CapabilityDescriptor[];
  /** Ver `DeviceDescriptor.transport` — opcional, solo presente si el driver lo informó. */
  transport?: "serial" | "wifi" | "bluetooth";
  address?: string;
}
