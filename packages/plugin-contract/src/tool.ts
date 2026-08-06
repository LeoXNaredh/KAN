/**
 * Vocabulario neutral del Function Calling Engine (docs/12-arquitectura-gateway.md,
 * sección 5). Ni @kan/ai-abstraction ni el Gateway importan nada del otro —
 * solo estos tipos. Es lo que hace posible cambiar de proveedor de IA sin
 * tocar cómo KAN decide y ejecuta.
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallProposal {
  name: string;
  args: unknown;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
}
