import type { ActionSeverity } from "./severity";
import type { JsonSchema } from "./jsonSchema";

export interface CapabilityDescriptor {
  name: string;
  description: string;
  severity: ActionSeverity;
  supportsDryRun: boolean;
  /**
   * JSON Schema real (docs/16 P1). Validado antes de invocar el driver,
   * en dos capas: `ToolResolver` (Gateway) y `CapabilityRegistry` (Edge
   * Agent) — ver `validateAgainstSchema` en `./schemaValidation`. Cubre
   * solo forma y tipos básicos; las reglas de negocio (rangos, formatos,
   * valores permitidos) siguen viviendo en el propio plugin.
   */
  inputSchema?: JsonSchema;
  /**
   * Nombre del campo del input que identifica el target físico afectado
   * (ej. "pin" para un GPIO). Habilita que la Safety Policy del dispositivo
   * (SafetyPolicyStore, @kan/edge-agent-core) sobrescriba la severidad de
   * esta capability por target individual. Sin este campo, la capability
   * nunca es afectada por overrides — usa siempre `severity` tal cual.
   */
  targetParam?: string;
}

export interface CapabilityResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
