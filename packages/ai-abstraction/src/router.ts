import type { AIProviderPort, ChatRequest, ChatResponse } from "@kan/core";

/**
 * Enruta a un proveedor primario, con fallback automático a los
 * siguientes si el primario lanza (rate limit, API caída, etc.) — cierra
 * el riesgo de negocio ya documentado en docs/11-riesgos.md ("Rate
 * limits de Gemini free-tier bloquean uso real con varios usuarios") y
 * el "nunca depender de un único proveedor" del prompt maestro (ver
 * ADR-054). Prueba cada proveedor configurado una sola vez, en el orden
 * dado — nunca reintenta el mismo proveedor dos veces en la misma
 * request (eso sería responsabilidad de cada adaptador, no del router).
 */
export class ModelRouter implements AIProviderPort {
  private readonly providers: readonly AIProviderPort[];
  private lastUsedProviderName: string;

  constructor(primary: AIProviderPort, fallbacks: AIProviderPort[] = []) {
    this.providers = [primary, ...fallbacks];
    this.lastUsedProviderName = primary.providerName;
  }

  /** Proveedor que efectivamente respondió la última request (el primario, antes de la primera). */
  get providerName(): string {
    return this.lastUsedProviderName;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const failures: string[] = [];

    for (const provider of this.providers) {
      try {
        const response = await provider.chat(request);
        this.lastUsedProviderName = provider.providerName;
        if (failures.length) {
          console.warn(
            `[ModelRouter] "${provider.providerName}" respondió como fallback — falló antes: ${failures.join(", ")}`,
          );
        } else {
          console.info(`[ModelRouter] "${provider.providerName}" respondió (primario)`);
        }
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${provider.providerName} (${message})`);
      }
    }

    throw new Error(`Todos los proveedores de IA fallaron: ${failures.join(" | ")}`);
  }
}
