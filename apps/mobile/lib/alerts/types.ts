// Mismo shape que AlertView en apps/web/lib/secuencias/types.ts — espejo
// escrito a mano, mismo criterio que lib/jobs/types.ts (evita bundlear
// @kan/gateway-core, pensado para el proceso del Gateway).
export interface AlertStepView {
  capabilityRef: string;
  input?: unknown;
}

export interface AlertView {
  alertId: string;
  capabilityRef: string;
  field?: string;
  comparator: "above" | "below";
  threshold: number;
  label: string;
  unit?: string;
  steps?: AlertStepView[];
}
