/** Mismo shape que TelemetryReading en @kan/gateway-core — pass-through BFF, sin depender de ese paquete. */
export interface TelemetryReadingView {
  value: number;
  at: string;
}

/** Mismo shape que TelemetrySensorSummary + `connected` que agrega GET /v1/telemetry. */
export interface SensorSummaryView {
  ref: string;
  edgeAgentId: string;
  deviceName: string;
  description: string;
  connected: boolean;
  /** Ausente solo del lado del cliente — un sensor recién descubierto (capability conectada, ningún poll resuelto todavía). El Gateway siempre lo manda si existe la entrada. */
  latest?: TelemetryReadingView;
}

export interface TelemetryPollResult {
  ref: string;
  success: boolean;
  value?: number;
  error?: string;
}
