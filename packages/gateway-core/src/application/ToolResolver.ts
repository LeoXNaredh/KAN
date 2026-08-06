import type { ToolRegistry } from "./ToolRegistry";

export interface ResolvedToolCall {
  ref: string;
  args: unknown;
}

export type ToolResolution = { ok: true; call: ResolvedToolCall } | { ok: false; error: string };

/**
 * Traduce la propuesta cruda de un LLM (nombre + args) a una llamada válida
 * y conocida. Si el modelo alucina un nombre, se rechaza aquí — antes de
 * que llegue a tocar nada real (docs/12 §5).
 */
export interface ToolResolverPort {
  resolve(proposedName: string, rawArgs: unknown): ToolResolution;
}

export class RegistryToolResolver implements ToolResolverPort {
  constructor(private readonly registry: ToolRegistry) {}

  resolve(proposedName: string, rawArgs: unknown): ToolResolution {
    const tool = this.registry.get(proposedName);
    if (!tool) {
      return { ok: false, error: `Herramienta desconocida: ${proposedName}` };
    }
    // Validación de inputSchema real: diferida (ver docs/04, mismo criterio
    // que el Edge Agent — el plugin valida su propio input por ahora).
    return { ok: true, call: { ref: proposedName, args: rawArgs } };
  }
}
