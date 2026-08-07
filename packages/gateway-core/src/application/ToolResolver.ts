import { validateAgainstSchema } from "@kan/plugin-contract";
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
    // Primera capa de defensa en profundidad (docs/16 P1) — la segunda vive
    // en CapabilityRegistry, del lado del Edge Agent.
    const validation = validateAgainstSchema(tool.inputSchema, rawArgs);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    return { ok: true, call: { ref: proposedName, args: rawArgs } };
  }
}
