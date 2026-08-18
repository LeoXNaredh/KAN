import type { ActionSeverity } from "@kan/plugin-contract";

/** Mismo shape que devuelve GET /v1/confirmations del Gateway (ConfirmationOrchestrator.list()) — sin traducción, ya apto para el cliente. */
export interface PendingConfirmationDTO {
  confirmationId: string;
  deviceId: string;
  capabilityName: string;
  input: unknown;
  severity: ActionSeverity;
}
