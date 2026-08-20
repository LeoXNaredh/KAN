// Mismo shape que apps/web/lib/sensores/types.ts — espejo escrito a mano,
// mismo criterio que lib/jobs/types.ts (evita bundlear @kan/gateway-core).
export interface TelemetryReadingView {
  value: number;
  at: string;
}

export interface SensorSummaryView {
  ref: string;
  edgeAgentId: string;
  deviceName: string;
  description: string;
  connected: boolean;
  latest?: TelemetryReadingView;
}

export interface TelemetryPollResult {
  ref: string;
  success: boolean;
  value?: number;
  error?: string;
}
