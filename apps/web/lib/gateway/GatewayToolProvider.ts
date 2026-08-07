import type { ToolProviderPort } from "@kan/core";
import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";

export interface GatewayToolProviderConfig {
  baseUrl: string;
  internalToken: string;
}

// El Gateway resuelve execute-tool en hasta ~40s (timeout interno de su
// TaskOrchestrator, ADR-027 — antes 15s, insuficiente para home_axes/plugin-gcode)
// — este límite debe ser mayor para no cortarlo antes de tiempo. listTools
// solo lee un registro en memoria, así que puede ser corto. Sin esto, un
// Gateway que acepta la conexión TCP pero no responde dejaba el chat colgado
// indefinidamente (hallazgo A7 de docs/13).
const LIST_TOOLS_TIMEOUT_MS = 5_000;
const EXECUTE_TOOL_TIMEOUT_MS = 45_000;

/**
 * Implementación HTTP de ToolProviderPort (docs/12): apps/web nunca habla
 * con el Edge Agent directo, siempre a través del Gateway.
 */
export class GatewayToolProvider implements ToolProviderPort {
  constructor(private readonly config: GatewayToolProviderConfig) {}

  async listTools(): Promise<ToolDescriptor[]> {
    const response = await fetch(`${this.config.baseUrl}/v1/tools`, {
      headers: { Authorization: `Bearer ${this.config.internalToken}` },
      signal: AbortSignal.timeout(LIST_TOOLS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Gateway respondió ${response.status} al listar tools`);
    }
    const body = (await response.json()) as { tools: ToolDescriptor[] };
    return body.tools;
  }

  async executeTool(name: string, args: unknown): Promise<ToolExecutionResult> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/tools/${encodeURIComponent(name)}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.internalToken}`,
        },
        body: JSON.stringify({ args }),
        signal: AbortSignal.timeout(EXECUTE_TOOL_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { success: false, error: `Gateway respondió ${response.status} al ejecutar ${name}` };
      }
      return (await response.json()) as ToolExecutionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `No se pudo contactar al Gateway: ${message}` };
    }
  }
}
