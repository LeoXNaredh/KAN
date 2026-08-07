import { randomUUID } from "node:crypto";
import { appendMessage, createConversation, type Conversation } from "../../domain/entities/Conversation";
import { createMessage, type Message } from "../../domain/entities/Message";
import type { AIProviderPort } from "../../domain/ports/AIProviderPort";
import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";

const SYSTEM_PROMPT =
  "Eres KAN, un asistente de IA capaz de controlar dispositivos físicos a través de plugins " +
  "(hoy: un dispositivo simulado; en el futuro: impresoras 3D, CNC, robots, microcontroladores). " +
  "Cuando el usuario pida algo que corresponda a una herramienta disponible, propone invocarla. " +
  "Tú solo propones — el sistema decide cómo y si se ejecuta. Si una herramienta requiere " +
  "confirmación, dile al usuario que debe confirmarla en la app de escritorio del Edge Agent.";

const MAX_TOOL_ROUNDS = 4;
// Límite superior de duración total del intercambio de tools (no de cada
// llamada individual): evita que una cadena de rondas se acerque al límite
// de duración de una función serverless (ADR-001, docs/00) — hallazgo A11
// de docs/13. No aborta una llamada en curso, solo impide iniciar otra ronda.
const MAX_TOTAL_DURATION_MS = 45_000;

export interface SendMessageInput {
  conversationId?: string;
  userMessage: string;
}

export interface SendMessageOutput {
  conversation: Conversation;
}

/**
 * Versión con function-calling del Agent Orchestrator (docs/03, docs/05):
 * el LLM solo propone tool calls; ejecutarlas pasa siempre por
 * `ToolProviderPort` (implementado en apps/web hablando con el Gateway,
 * docs/12) — este caso de uso nunca toca hardware directamente.
 */
export class SendMessageUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly conversationRepository: ConversationRepositoryPort,
    private readonly toolProvider?: ToolProviderPort,
    private readonly memoryContext?: MemoryContextPort,
  ) {}

  async execute(input: SendMessageInput): Promise<SendMessageOutput> {
    let conversation = input.conversationId
      ? (await this.conversationRepository.getById(input.conversationId)) ?? createConversation()
      : createConversation();

    conversation = appendMessage(conversation, createMessage("user", input.userMessage));

    const tools = await this.safeListTools();
    const systemPrompt = await this.buildSystemPrompt();
    let finished = false;
    const startedAt = Date.now();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (Date.now() - startedAt > MAX_TOTAL_DURATION_MS) break;

      const response = await this.aiProvider.chat({
        messages: conversation.messages,
        systemPrompt,
        tools,
      });

      if (response.toolCalls?.length && this.toolProvider) {
        for (const call of response.toolCalls) {
          const assistantMessage: Message = {
            id: randomUUID(),
            role: "assistant",
            content: response.content ?? "",
            createdAt: new Date().toISOString(),
            toolCall: call,
          };
          conversation = appendMessage(conversation, assistantMessage);

          const result = await this.toolProvider.executeTool(call.name, call.args);
          const toolMessage: Message = {
            id: randomUUID(),
            role: "tool",
            content: summarizeToolResult(call.name, result),
            createdAt: new Date().toISOString(),
            toolResult: { name: call.name, success: result.success, data: result.data, error: result.error },
          };
          conversation = appendMessage(conversation, toolMessage);
        }
        continue;
      }

      conversation = appendMessage(conversation, createMessage("assistant", response.content ?? ""));
      finished = true;
      break;
    }

    if (!finished) {
      conversation = appendMessage(
        conversation,
        createMessage("assistant", "No pude completar la solicitud usando las herramientas disponibles tras varios intentos."),
      );
    }

    await this.conversationRepository.save(conversation);

    return { conversation };
  }

  private async safeListTools() {
    if (!this.toolProvider) return undefined;
    try {
      return await this.toolProvider.listTools();
    } catch {
      // El Gateway no está disponible — el chat sigue funcionando sin tools.
      return undefined;
    }
  }

  /**
   * Memoria inyectada como contexto adicional del systemPrompt (docs/17
   * §3.6) — mismo criterio que las tools: si falla o no hay proveedor de
   * memoria configurado, el chat sigue funcionando igual, solo sin memoria.
   */
  private async buildSystemPrompt(): Promise<string> {
    if (!this.memoryContext) return SYSTEM_PROMPT;
    try {
      const memories = await this.memoryContext.listRelevant();
      if (!memories.length) return SYSTEM_PROMPT;
      const facts = memories.map((m) => `- [${m.category}] ${m.key}: ${JSON.stringify(m.value)}`).join("\n");
      return `${SYSTEM_PROMPT}\n\nEsto es lo que ya sabes de este usuario (úsalo si es relevante, no lo repitas sin que aporte):\n${facts}`;
    } catch {
      return SYSTEM_PROMPT;
    }
  }
}

function summarizeToolResult(name: string, result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) return `Error ejecutando ${name}: ${result.error ?? "desconocido"}`;
  return `Resultado de ${name}: ${JSON.stringify(result.data)}`;
}
