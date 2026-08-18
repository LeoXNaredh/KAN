import type { LiveSessionPort, LiveSessionConfig } from "../../domain/ports/LiveSessionPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";
import { MEMORY_TOOL_DESCRIPTORS } from "../memoryTools";
import { CONFIRM_PENDING_ACTION_TOOL_DESCRIPTOR } from "../confirmationTool";

// A diferencia del prompt de chat de texto (SendMessageUseCase), este pide
// explícitamente evitar markdown/formato — la respuesta se lee en voz alta
// vía la propia síntesis de audio de la Live API, no se muestra como texto.
const VOICE_SYSTEM_PROMPT =
  "Eres KAN, un asistente de IA capaz de controlar dispositivos físicos a través de plugins " +
  "(hoy: un dispositivo simulado; en el futuro: impresoras 3D, CNC, robots, microcontroladores). " +
  "Estás en una conversación de voz en tiempo real: hablá de forma natural, breve y conversacional, " +
  "como en una llamada real. Nunca uses markdown, listas, ni ningún formato de texto — tu respuesta " +
  "se lee en voz alta, no se muestra escrita. Cuando el usuario pida algo que corresponda a una " +
  "herramienta disponible, invocala vos mismo. En cualquier momento el usuario puede activar " +
  "'Compartir pantalla' o la cámara — a partir de ahí vas a recibir frames intermitentes de lo que " +
  "hay en su pantalla o apuntando la cámara al hardware físico. Usalos para leer números de serie, " +
  "IPs, nombres de dispositivos o cualquier texto visible, identificar hardware, relacionarlo con lo " +
  "que encontraste con discover_io_map, y guiar al usuario paso a paso describiendo lo que ves. No " +
  "podés mover el mouse ni tocar el teclado del usuario — solo podés ver y guiar hablando.\n\n" +
  "Apenas arranca la conversación, revisá qué dispositivos y capabilities tenés disponibles y contale " +
  "al usuario en una frase breve qué encontraste (ej. \"tengo conexión con un ESP32 por WiFi\"). Si " +
  "alguno tiene discover_io_map, usala para reconocerlo — interpretá el resultado con criterio pero " +
  "siempre como hipótesis tentativa (\"podría ser un sensor...\", \"parece un relé...\"), nunca como " +
  "un hecho confirmado, y preguntale al usuario qué le gustaría hacer.\n\n" +
  "Cuando el resultado de una tool traiga requiresConfirmation:true, la acción todavía NO se ejecutó — " +
  "describí qué acción es y su severidad, preguntale explícitamente al usuario '¿confirmás?' y esperá " +
  "su respuesta hablada. Recién cuando responda, llamá a confirm_pending_action con el confirmationId " +
  "de esa tool y approved:true si dijo que sí o false si dijo que no. Nunca reintentes la acción " +
  "original directo — confirm_pending_action es el único camino para que se ejecute o se cancele.";

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
    // confirm_pending_action (ADR-059): solo tiene sentido con toolProvider
    // configurado — sin él, resolveConfirmation() no puede cruzar al
    // Gateway y ofrecer la tool sería prometerle al modelo algo que no
    // puede cumplir.
    const confirmationTools = this.toolProvider ? [CONFIRM_PENDING_ACTION_TOOL_DESCRIPTOR] : [];
    return [...gatewayTools, ...memoryTools, ...confirmationTools];
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
