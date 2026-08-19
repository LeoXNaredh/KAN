import type { ActionSeverity, JsonSchema } from "@kan/plugin-contract";

/** Mismo shape que el capability agrupado que devuelve GET /v1/capabilities (Gateway) — pass-through BFF, igual criterio que ScheduledJobView en lib/jobs/types.ts. */
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

export interface SequenceStepView {
  capabilityRef: string;
  input: Record<string, unknown>;
}

/** Mismo shape que SequenceStepReport en @kan/gateway-core (runSteps) — nunca incluye JSON crudo, solo lenguaje simple. */
export interface SequenceStepReportView {
  deviceName: string;
  description: string;
  outcome: "done" | "failed" | "pending_confirmation";
  error?: string;
}

/** Mismo shape que summarize(AlertRule) en alertTools.ts. */
export interface AlertView {
  alertId: string;
  capabilityRef: string;
  field?: string;
  comparator: "above" | "below";
  threshold: number;
  label: string;
  unit?: string;
  steps?: SequenceStepView[];
}

/** Solo local (localStorage) — ni kan_run_sequence ni kan_set_alert tienen un concepto de "secuencia con nombre" del lado del servidor para el caso manual (ver DESIGN_SYSTEM/plan). */
export interface SavedSequence {
  id: string;
  name: string;
  steps: SequenceStepView[];
  createdAt: string;
}
