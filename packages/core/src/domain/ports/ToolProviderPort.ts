import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";

/**
 * Puerto hacia el Gateway (docs/12): el Core Cloud (apps/web) nunca habla
 * directo con el Gateway — solo conoce esta interfaz. La implementación real
 * (`GatewayToolProvider`, HTTP) vive en apps/web, no aquí.
 */
export interface ToolProviderPort {
  listTools(): Promise<ToolDescriptor[]>;
  executeTool(name: string, args: unknown): Promise<ToolExecutionResult>;
  /**
   * Resuelve una confirmación pendiente (irreversible-material/safety-critical,
   * ADR-059) — separado de `executeTool()` porque no es una propuesta del
   * LLM que pase por el resolver de nombres del Gateway, es una decisión
   * explícita del usuario (botón en el chat, o la tool `confirm_pending_action`
   * en voz) sobre una acción que YA quedó identificada antes.
   */
  resolveConfirmation(confirmationId: string, approved: boolean): Promise<ToolExecutionResult>;
}
