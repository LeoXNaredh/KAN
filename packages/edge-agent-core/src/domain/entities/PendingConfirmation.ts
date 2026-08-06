import type { ActionSeverity } from "@kan/plugin-contract";

export interface PendingConfirmation {
  id: string;
  deviceId: string;
  capabilityName: string;
  input: unknown;
  severity: ActionSeverity;
  requestedAt: string;
}
