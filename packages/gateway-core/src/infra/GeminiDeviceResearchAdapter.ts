import { GoogleGenAI } from "@google/genai";
import type { LoggerPort } from "@kan/plugin-contract";
import type { DeviceResearchPort, DeviceResearchResult } from "../domain/ports/DeviceResearchPort";

// Mismo catálogo rotativo que @kan/ai-abstraction/GeminiProvider (ver ese
// archivo) — acá directo, no a través de ese paquete, porque esta llamada
// necesita el tool `googleSearch` (grounding), que ChatRequest/AIProviderPort
// no expone y que además conviene mantener separado de la llamada de chat
// con function-calling (mezclar googleSearch con functionDeclarations en la
// misma request es, en el mejor de los casos, ambiguo — evitado del todo acá).
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export interface GeminiDeviceResearchConfig {
  apiKey: string;
  model?: string;
}

function buildPrompt(deviceKind: string, deviceNames: string[]): string {
  const namesList = deviceNames.length ? deviceNames.join(", ") : deviceKind;
  return (
    `Investigá el siguiente tipo de dispositivo/hardware conectado a un sistema de automatización: "${deviceKind}" ` +
    `(nombres reales reportados: ${namesList}). Buscá en la web información real y específica. Respondé en español, ` +
    `en Markdown, cubriendo lo que encuentres de esta lista (omití lo que no aplique, no inventes):\n` +
    `- Especificaciones generales\n` +
    `- Pines / interfaces disponibles\n` +
    `- Protocolos que soporta\n` +
    `- Voltajes y corrientes máximas\n` +
    `- Notas típicas de conexión/cableado\n` +
    `- Casos de uso comunes\n` +
    `- Advertencias de seguridad relevantes\n\n` +
    `Si "${deviceKind}" es un tipo de conexión genérico (ej. un protocolo de red, un cliente HTTP/WebSocket) y no ` +
    `un producto físico identificable, respondé exactamente: "Sin información específica de producto para este tipo." ` +
    `— no inventes specs de hardware que no existe.`
  );
}

const NO_INFO_MARKER = "sin información específica de producto";

/**
 * Investigación de dispositivos con búsqueda web real (ADR-053) — vive acá
 * (gateway-core/infra), no en @kan/ai-abstraction, mismo criterio que
 * GeminiLiveProxy: integración Gemini-específica del lado del Gateway.
 * Llamada única, sin estado de conversación ni tools propias — separada a
 * propósito del chat de function-calling (`GeminiProvider`).
 */
export class GeminiDeviceResearchAdapter implements DeviceResearchPort {
  private readonly client: GoogleGenAI;
  private readonly modelName: string;

  constructor(
    config: GeminiDeviceResearchConfig,
    private readonly logger: LoggerPort,
  ) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.modelName = config.model ?? DEFAULT_MODEL;
  }

  async research(deviceKind: string, deviceNames: string[]): Promise<DeviceResearchResult | undefined> {
    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ role: "user", parts: [{ text: buildPrompt(deviceKind, deviceNames) }] }],
        config: { tools: [{ googleSearch: {} }] },
      });

      const summary = response.text?.trim();
      if (!summary || summary.toLowerCase().includes(NO_INFO_MARKER)) return undefined;

      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.map((chunk) => chunk.web?.uri)
        .filter((uri): uri is string => Boolean(uri));

      return { summary, sources: sources?.length ? sources : undefined };
    } catch (error) {
      // Best-effort a propósito (ADR-053): un fallo acá nunca debe tumbar la
      // conexión del Edge Agent que lo disparó — DeviceEnrichmentService ya
      // trata cualquier research() fallido como "sin resultado esta vez".
      this.logger.error(`[GeminiDeviceResearchAdapter] falló investigando "${deviceKind}": ${error}`);
      return undefined;
    }
  }
}
