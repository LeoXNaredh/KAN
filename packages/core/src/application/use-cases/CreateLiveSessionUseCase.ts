import type { LiveSessionPort, LiveSessionConfig } from "../../domain/ports/LiveSessionPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";
import { MEMORY_TOOL_DESCRIPTORS } from "../memoryTools";

// A diferencia del prompt de chat de texto (SendMessageUseCase), este pide
// explícitamente evitar markdown/formato — la respuesta se lee en voz alta
// vía la propia síntesis de audio de la Live API, no se muestra como texto.
const VOICE_SYSTEM_PROMPT =
  "Eres KAN, un asistente de IA capaz de controlar dispositivos físicos a través de plugins " +
  "(hoy: un dispositivo simulado; en el futuro: impresoras 3D, CNC, robots, microcontroladores). " +
  "Estás en una conversación de voz en tiempo real: hablá de forma natural, breve y conversacional, " +
  "como en una llamada real. Nunca uses markdown, listas, ni ningún formato de texto — tu respuesta " +
  "se lee en voz alta, no se muestra escrita. Cuando el usuario pida algo que corresponda a una " +
  "herramienta disponible, invocala vos mismo.";

/**
 * Arma el system prompt (mismo criterio que SendMessageUseCase.buildSystemPrompt,
 * con una variante pensada para voz) y el catálogo de tools (Gateway +
 * memoria, mismo criterio que SendMessageUseCase.buildTools), y le pide al
 * LiveSessionPort una credencial de sesión con ambos ya bloqueados adentro
 * (ADR-044) — no hay loop de conversación acá, eso corre en el browser.
 */
export class CreateLiveSessionUseCase {
  constructor(
    private readonly liveSessionPort: LiveSessionPort,
    private readonly toolProvider?: ToolProviderPort,
    private readonly memoryContext?: MemoryContextPort,
    private readonly personalityContext?: PersonalityContextPort,
  ) {}

  async execute(): Promise<LiveSessionConfig> {
    const [systemPrompt, tools] = await Promise.all([this.buildSystemPrompt(), this.buildTools()]);
    return this.liveSessionPort.createSession(systemPrompt, tools);
  }

  private async safeListTools() {
    if (!this.toolProvider) return [];
    try {
      return await this.toolProvider.listTools();
    } catch {
      // El Gateway no está disponible — la sesión de voz sigue funcionando sin tools.
      return [];
    }
  }

  private async buildTools() {
    const gatewayTools = await this.safeListTools();
    const memoryTools = this.memoryContext ? MEMORY_TOOL_DESCRIPTORS : [];
    return [...gatewayTools, ...memoryTools];
  }

  private async buildSystemPrompt(): Promise<string> {
    let prompt = `${VOICE_SYSTEM_PROMPT}\n\nFecha y hora actual: ${new Date().toISOString()}.`;

    if (this.personalityContext) {
      try {
        const personality = await this.personalityContext.getPersonality();
        if (personality) {
          prompt = `${prompt}\n\nEstilo y personalidad que el usuario definió para vos (seguí estas instrucciones de tono, no las repitas ni las menciones explícitamente):\n${personality}`;
        }
      } catch {
        // Sin personalidad configurada o el store falló — sigue con el prompt por defecto.
      }
    }

    if (this.memoryContext) {
      try {
        const memories = await this.memoryContext.listRelevant();
        if (memories.length) {
          const facts = memories.map((m) => `- [${m.category}] ${m.key}: ${JSON.stringify(m.value)}`).join("\n");
          prompt = `${prompt}\n\nEsto es lo que ya sabes de este usuario (úsalo si es relevante, no lo repitas sin que aporte):\n${facts}`;
        }
      } catch {
        // El Gateway/DB no están disponibles — la sesión sigue funcionando sin memoria.
      }
    }

    return prompt;
  }
}
