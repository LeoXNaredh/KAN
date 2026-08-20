// Mismo shape que apps/web/lib/secuencias/types.ts (CapabilityView,
// DeviceCapabilitiesView) y packages/plugin-contract (JsonSchema,
// ActionSeverity) — espejo escrito a mano, mismo criterio que
// lib/jobs/types.ts (evita bundlear @kan/plugin-contract/@kan/gateway-core).
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  [keyword: string]: unknown;
}

export type ActionSeverity = "read-only" | "reversible" | "irreversible-material" | "safety-critical";

export interface CapabilityView {
  ref: string;
  name: string;
  description: string;
  severity: ActionSeverity;
  supportsDryRun: boolean;
  inputSchema: JsonSchema;
}

export interface DeviceCapabilitiesView {
  edgeAgentId: string;
  deviceId: string;
  deviceName: string;
  capabilities: CapabilityView[];
}
