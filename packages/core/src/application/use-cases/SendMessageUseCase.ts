import { randomUUID } from "node:crypto";
import { appendMessage, createConversation, type Conversation } from "../../domain/entities/Conversation";
import { createMessage, type Message, type MessageImage } from "../../domain/entities/Message";
import type { AIProviderPort } from "../../domain/ports/AIProviderPort";
import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";
import { MEMORY_TOOL_DESCRIPTORS, isMemoryToolName, executeMemoryTool } from "../memoryTools";

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
// 90s (ADR-027, docs/16 P7): presupuesto para una tool call lenta (el
// Gateway ya puede tardar hasta ~40s en TaskOrchestrator, ver
// GatewayToolProvider) más una ronda final del LLM.
const MAX_TOTAL_DURATION_MS = 90_000;

export interface SendMessageInput {
  conversationId?: string;
  userMessage: string;
  /** Imagen adjunta al mensaje (P3, Visión) — opcional, ver ADR-018. */
  image?: MessageImage;
}

export interface SendMessageOutput {
  conversation: Conversation;
}

/**
 * Eventos incrementales del loop de function-calling (ADR-027, docs/16 P7)
 * — streaming a nivel de "qué está haciendo el loop", no progreso fino
 * dentro de una sola capability (`ToolProviderPort.executeTool()` sigue
 * siendo una única espera bloqueante).
 */
export type ChatStreamEvent =
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; success: boolean; data?: unknown; error?: string }
  | { type: "final"; content: string };

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
    private readonly personalityContext?: PersonalityContextPort,
  ) {}

  async execute(input: SendMessageInput, onEvent?: (event: ChatStreamEvent) => void): Promise<SendMessageOutput> {
    let conversation = input.conversationId
      ? (await this.conversationRepository.getById(input.conversationId)) ?? createConversation()
      : createConversation();

    conversation = appendMessage(conversation, createMessage("user", input.userMessage, input.image));

    const tools = await this.buildTools();
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

      if (response.toolCalls?.length && (this.toolProvider || this.memoryContext)) {
        for (const call of response.toolCalls) {
          const assistantMessage: Message = {
            id: randomUUID(),
            role: "assistant",
            content: response.content ?? "",
            createdAt: new Date().toISOString(),
            toolCall: call,
          };
          conversation = appendMessage(conversation, assistantMessage);
          onEvent?.({ type: "tool_call", name: call.name, args: call.args });

          // Memoria (ADR-035) nunca pasa por toolProvider/Gateway — se
          // despacha acá mismo, siempre que haya memoryContext.
          const result =
            isMemoryToolName(call.name) && this.memoryContext
              ? await executeMemoryTool(this.memoryContext, call.name, call.args)
              : this.toolProvider
                ? await this.toolProvider.executeTool(call.name, call.args)
                : { success: false as const, error: `Herramienta no disponible: ${call.name}` };
          onEvent?.({
            type: "tool_result",
            name: call.name,
            success: result.success,
            data: result.data,
            error: result.error,
          });
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
      onEvent?.({ type: "final", content: response.content ?? "" });
      finished = true;
      break;
    }

    if (!finished) {
      const fallbackContent = "No pude completar la solicitud usando las herramientas disponibles tras varios intentos.";
      conversation = appendMessage(conversation, createMessage("assistant", fallbackContent));
      onEvent?.({ type: "final", content: fallbackContent });
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
   * Tools del Gateway (si hay) + tools internas de memoria (ADR-035, siempre
   * que haya memoryContext, sin depender del Gateway) — `undefined` si el
   * resultado queda vacío, para no cambiar el request cuando no hay nada
   * que ofrecer (mismo comportamiento que antes de este método existir).
   */
  private async buildTools() {
    const gatewayTools = (await this.safeListTools()) ?? [];
    const memoryTools = this.memoryContext ? MEMORY_TOOL_DESCRIPTORS : [];
    const tools = [...gatewayTools, ...memoryTools];
    return tools.length ? tools : undefined;
  }

  /**
   * Personalidad y memoria inyectadas como contexto adicional del
   * systemPrompt (docs/17 §3.2/§3.6) — mismo criterio que las tools: si
   * falla o no hay proveedor configurado, el chat sigue funcionando igual,
   * solo sin esa pieza de contexto.
   */
  private async buildSystemPrompt(): Promise<string> {
    let prompt = SYSTEM_PROMPT;

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
        // El Gateway/DB no están disponibles — el chat sigue funcionando sin memoria.
      }
    }

    return prompt;
  }
}

function summarizeToolResult(name: string, result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) return `Error ejecutando ${name}: ${result.error ?? "desconocido"}`;
  return `Resultado de ${name}: ${JSON.stringify(result.data)}`;
}
