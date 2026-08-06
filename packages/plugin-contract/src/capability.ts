import type { ActionSeverity } from "./severity";

export interface CapabilityDescriptor {
  name: string;
  description: string;
  severity: ActionSeverity;
  supportsDryRun: boolean;
  /** Esquema de entrada, sin validar en runtime todavía (ver plan de este incremento). */
  inputSchema?: Record<string, unknown>;
}

export interface CapabilityResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
