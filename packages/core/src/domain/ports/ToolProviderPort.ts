import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";

/**
 * Puerto hacia el Gateway (docs/12): el Core Cloud (apps/web) nunca habla
 * directo con el Gateway — solo conoce esta interfaz. La implementación real
 * (`GatewayToolProvider`, HTTP) vive en apps/web, no aquí.
 */
export interface ToolProviderPort {
  listTools(): Promise<ToolDescriptor[]>;
  executeTool(name: string, args: unknown): Promise<ToolExecutionResult>;
}
