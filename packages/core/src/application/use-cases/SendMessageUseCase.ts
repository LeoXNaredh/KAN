import { randomUUID } from "node:crypto";
import type { ActionSeverity, ToolExecutionResult } from "@kan/plugin-contract";
import { appendMessage, createConversation, type Conversation } from "../../domain/entities/Conversation";
import { createMessage, type Message, type MessageImage } from "../../domain/entities/Message";
import type { AIProviderPort } from "../../domain/ports/AIProviderPort";
import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";
import type { SessionContextPort } from "../../domain/ports/SessionContextPort";
import { MEMORY_TOOL_DESCRIPTORS, isMemoryToolName, executeMemoryTool } from "../memoryTools";
import { deviceDisplayNameMemoryKey } from "../deviceNaming";
import { SESSION_CONTEXT_TOOL_DESCRIPTORS, isSessionContextToolName, executeSessionContextTool } from "../sessionContextTools";
import { translateToolResult } from "../translateToolCall";

/**
 * Personalidad por defecto de KAN (VISION_PRODUCT_v0.2.md §4.4, roadmap
 * Línea B #2) — se aplica siempre, incluso sin `personalityContext`
 * configurado por el usuario; lo que el usuario define en /configuracion se
 * agrega encima, nunca lo reemplaza (ver `buildSystemPrompt`). Regla dura,
 * no solo de tono: KAN nunca nombra su propia infraestructura interna
 * (Gateway, Edge Agent, Core, proveedor de IA, base de datos, "plugin") —
 * para quien lo usa, KAN es la única entidad con la que habla.
 */
const SYSTEM_PROMPT =
  "Sos KAN, un asistente inteligente que ayuda a esta persona con su mundo digital y físico — " +
  "leer sensores, mover ejes, imprimir piezas, analizar fotos, investigar un tema o simplemente " +
  "charlar. Hablás como lo haría un colega experto y cercano: profesional, directo, sin rodeos " +
  "innecesarios, pero nunca frío ni robótico. Nunca mencionás detalles de tu propia infraestructura " +
  "(nombres de sistemas internos, proveedores de IA, bases de datos, ni nada técnico de cómo estás " +
  "construido) — para quien te usa, vos sos la única entidad con la que habla, no una interfaz " +
  "sobre otra cosa.\n\n" +
  "Cuando el usuario pida algo que corresponda a una acción disponible, proponé usarla — vos solo " +
  "proponés, el sistema decide cómo y si se ejecuta. Antes de actuar sobre algo físico o " +
  "irreversible, explicá en una frase simple qué vas a hacer. Si hace falta que el usuario confirme " +
  "la acción, decíselo con naturalidad (\"esto necesita que lo confirmes antes de hacerlo\"), sin " +
  "mencionar de qué sistema viene esa confirmación. Si algo falla o no podés hacerlo, explicá el " +
  "motivo en términos simples — nunca un error técnico crudo — y si podés, sugerí una alternativa. " +
  "Cuando te falte información para actuar con confianza, preguntá antes de asumir.\n\n" +
  "Cuando en la conversación aparezca el nombre técnico de un dispositivo (ej. \"HC-02\", \"COM3\", " +
  "\"ttyUSB0\", una dirección MAC, un ID de serie) y no tengas ya guardado un nombre personalizado " +
  `para él (revisá las memorias de categoría "dispositivos" con clave "${deviceDisplayNameMemoryKey("<nombre técnico exacto>")}"), ` +
  "preguntale al usuario cómo prefiere llamarlo antes de seguir usando ese nombre técnico. Guardá su " +
  `respuesta con kan_set_memory (categoría "dispositivos", clave "${deviceDisplayNameMemoryKey("")}" + el nombre técnico ` +
  "EXACTO tal como aparece — sin normalizarlo ni traducirlo —, valor el nombre elegido) y a partir de " +
  "ahí referite siempre a ese dispositivo por su nombre personalizado, nunca por el técnico.\n\n" +
  "Cuando uses discover_io_map (ADR-058) para reconocer un dispositivo recién conectado, interpretá el " +
  "resultado con criterio pero SIN asumir qué hay conectado a cada pin como si fuera un hecho — un pin " +
  "analógico probablemente sea un sensor de medición, una salida digital probablemente sea un relé u otro " +
  "control on/off, pero eso es una hipótesis, no un dato confirmado. Ofrecela así, con lenguaje que deje " +
  "lugar a corrección (\"podría ser...\", \"parece un...\"), nunca la afirmes como si la supieras con " +
  "certeza. Cerrá siempre el resumen preguntándole al usuario qué le gustaría hacer con ese sistema.";

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
  /**
   * Reanuda un turno que quedó esperando una confirmación explícita
   * (ADR-059) — cuando está presente, `execute()` no agrega `userMessage`
   * ni llama al modelo primero: resuelve la confirmación, agrega el
   * intercambio como un tool call sintético, y sigue el loop normal para
   * que el modelo reaccione. `userMessage` se ignora en este caso (puede
   * quedar vacío desde el cliente).
   */
  confirmationResponse?: { confirmationId: string; approved: boolean };
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
  | { type: "final"; content: string }
  /**
   * ADR-059: el turno se detuvo porque una acción propuesta necesita
   * confirmación explícita del usuario antes de ejecutarse — el cliente
   * debe mostrar un diálogo (título "Confirmar acción física", esta
   * descripción, severidad) y, cuando el usuario decida, volver a llamar
   * `execute()` con `confirmationResponse: {confirmationId, approved}`.
   */
  | {
      type: "pending_confirmation";
      confirmationId: string;
      deviceId: string;
      capabilityName: string;
      input: unknown;
      severity: ActionSeverity;
    };

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
    private readonly sessionContext?: SessionContextPort,
  ) {}

  async execute(input: SendMessageInput, onEvent?: (event: ChatStreamEvent) => void): Promise<SendMessageOutput> {
    let conversation = input.conversationId
      ? (await this.conversationRepository.getById(input.conversationId)) ?? createConversation()
      : createConversation();

    conversation = input.confirmationResponse
      ? await this.resumeFromConfirmation(conversation, input.confirmationResponse, onEvent)
      : appendMessage(conversation, createMessage("user", input.userMessage, input.image));

    const tools = await this.buildTools();
    const systemPrompt = await this.buildSystemPrompt();
    let finished = false;
    let pendingConfirmation: Extract<ChatStreamEvent, { type: "pending_confirmation" }> | undefined;
    const startedAt = Date.now();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (Date.now() - startedAt > MAX_TOTAL_DURATION_MS) break;

      const response = await this.aiProvider.chat({
        messages: conversation.messages,
        systemPrompt,
        tools,
      });

      if (response.toolCalls?.length && (this.toolProvider || this.memoryContext || this.sessionContext)) {
        // Corre el batch completo siempre, sin cortar a mitad de camino — un
        // `break` apenas aparece una confirmación pendiente dejaría a las
        // tool calls siguientes del mismo batch sin mensaje ni rastro
        // (ADR-059, hallazgo de validación). Recién después de terminar el
        // batch se decide si la RONDA sigue o corta acá.
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

          // Memoria (ADR-035) y contexto de sesión (ADR-055) nunca pasan por
          // toolProvider/Gateway — se despachan acá mismo, siempre que haya
          // el puerto correspondiente.
          const result: ToolExecutionResult =
            isMemoryToolName(call.name) && this.memoryContext
              ? await executeMemoryTool(this.memoryContext, call.name, call.args)
              : isSessionContextToolName(call.name) && this.sessionContext
                ? await executeSessionContextTool(this.sessionContext, call.name, call.args)
                : this.toolProvider
                  ? await this.toolProvider.executeTool(call.name, call.args)
                  : { success: false, error: `Herramienta no disponible: ${call.name}` };
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

          // ADR-059: severidad irreversible-material/safety-critical sin
          // confirmar todavía. Si el modelo pidió varias acciones peligrosas
          // en el mismo batch, solo la primera se ofrece a confirmar — las
          // demás quedan para una ronda posterior (mismo criterio que ya usa
          // apps/desktop: ConfirmationModal solo muestra pending[0]).
          if (result.requiresConfirmation && !pendingConfirmation) {
            const data = result.data as
              | { confirmationId?: string; deviceId?: string; capabilityName?: string; input?: unknown; severity?: ActionSeverity }
              | undefined;
            if (data?.confirmationId) {
              pendingConfirmation = {
                type: "pending_confirmation",
                confirmationId: data.confirmationId,
                deviceId: data.deviceId ?? "",
                capabilityName: data.capabilityName ?? call.name,
                input: data.input ?? call.args,
                severity: data.severity ?? "irreversible-material",
              };
            }
          }
        }
        if (pendingConfirmation) break;
        continue;
      }

      conversation = appendMessage(conversation, createMessage("assistant", response.content ?? ""));
      onEvent?.({ type: "final", content: response.content ?? "" });
      finished = true;
      break;
    }

    if (pendingConfirmation) {
      // El turno termina acá a propósito, sin mensaje "final" — es un estado
      // válido en espera de una decisión del usuario, no una falla.
      onEvent?.(pendingConfirmation);
    } else if (!finished) {
      const fallbackContent = "No pude completar la solicitud usando las herramientas disponibles tras varios intentos.";
      conversation = appendMessage(conversation, createMessage("assistant", fallbackContent));
      onEvent?.({ type: "final", content: fallbackContent });
    }

    await this.conversationRepository.save(conversation);

    return { conversation };
  }

  /**
   * Reanuda un turno que había quedado en `pending_confirmation` (ADR-059).
   * Agrega el intercambio como un par assistant(toolCall)/tool(resultado)
   * sintético — igual que cualquier tool call real del loop de arriba — en
   * vez de agregar el resultado suelto: sin el mensaje `assistant` previo,
   * Anthropic/OpenAI no tienen a qué `tool_use_id`/`tool_call_id` asociar el
   * resultado (ambos lo derivan del índice del mensaje `assistant` anterior,
   * ver `toolUseId()`/`toolCallId()` en cada provider) y los 3 proveedores
   * quedarían con dos mensajes "tool"/"user" consecutivos sin alternancia.
   */
  private async resumeFromConfirmation(
    conversation: Conversation,
    confirmationResponse: { confirmationId: string; approved: boolean },
    onEvent?: (event: ChatStreamEvent) => void,
  ): Promise<Conversation> {
    const toolName = "confirm_pending_action";
    const args = { confirmationId: confirmationResponse.confirmationId, approved: confirmationResponse.approved };

    const assistantMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      toolCall: { name: toolName, args },
    };
    let conv = appendMessage(conversation, assistantMessage);
    onEvent?.({ type: "tool_call", name: toolName, args });

    const result: ToolExecutionResult = this.toolProvider
      ? await this.toolProvider.resolveConfirmation(confirmationResponse.confirmationId, confirmationResponse.approved)
      : { success: false, error: "No hay conexión con el Gateway para resolver la confirmación." };
    onEvent?.({ type: "tool_result", name: toolName, success: result.success, data: result.data, error: result.error });

    const toolMessage: Message = {
      id: randomUUID(),
      role: "tool",
      content: summarizeToolResult(toolName, result),
      createdAt: new Date().toISOString(),
      toolResult: { name: toolName, success: result.success, data: result.data, error: result.error },
    };
    return appendMessage(conv, toolMessage);
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
   * Tools del Gateway (si hay) + tools internas de memoria (ADR-035) +
   * tools internas de contexto de sesión (ADR-055) — cada una solo si el
   * puerto correspondiente está inyectado, sin depender del Gateway.
   * `undefined` si el resultado queda vacío, para no cambiar el request
   * cuando no hay nada que ofrecer (mismo comportamiento que antes).
   */
  private async buildTools() {
    const gatewayTools = (await this.safeListTools()) ?? [];
    const memoryTools = this.memoryContext ? MEMORY_TOOL_DESCRIPTORS : [];
    const sessionContextTools = this.sessionContext ? SESSION_CONTEXT_TOOL_DESCRIPTORS : [];
    const tools = [...gatewayTools, ...memoryTools, ...sessionContextTools];
    return tools.length ? tools : undefined;
  }

  /**
   * Personalidad y memoria inyectadas como contexto adicional del
   * systemPrompt (docs/17 §3.2/§3.6) — mismo criterio que las tools: si
   * falla o no hay proveedor configurado, el chat sigue funcionando igual,
   * solo sin esa pieza de contexto.
   */
  private async buildSystemPrompt(): Promise<string> {
    // Sin esto, el modelo no tiene forma de saber "hoy"/"ahora" y calcula
    // fechas relativas (kan_schedule_job con runAt "dentro de 20 segundos",
    // etc.) contra su fecha de corte de entrenamiento — siempre en el
    // pasado, siempre rechazado por NodeCronScheduler (ADR-039), sin poder
    // autocorregirse nunca porque no tiene con qué calcular una fecha futura
    // real. Hallazgo en vivo, ADR-039.
    let prompt = `${SYSTEM_PROMPT}\n\nFecha y hora actual: ${new Date().toISOString()}.`;

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

    if (this.sessionContext) {
      try {
        const contextLine = await this.describeSessionContext();
        if (contextLine) prompt = `${prompt}\n\n${contextLine}`;
      } catch {
        // El store en memoria no debería fallar nunca, pero el mismo
        // criterio best-effort del resto de este método aplica igual.
      }
    }

    return prompt;
  }

  /**
   * ADR-055: arma "Dispositivo activo: X. Proyecto activo: Y. Tarea
   * actual: Z." con solo los campos que efectivamente tengan valor —
   * `undefined` (no un string vacío) si no hay ninguno, para no meter una
   * línea vacía en el systemPrompt cuando el usuario todavía no fijó nada.
   */
  private async describeSessionContext(): Promise<string | undefined> {
    if (!this.sessionContext) return undefined;

    const [activeDevice, activeProject, currentTask] = await Promise.all([
      this.sessionContext.getActiveDevice(),
      this.sessionContext.getActiveProject(),
      this.sessionContext.getCurrentTask(),
    ]);

    const parts: string[] = [];
    if (activeDevice) parts.push(`Dispositivo activo: ${activeDevice}.`);
    if (activeProject) parts.push(`Proyecto activo: ${activeProject}.`);
    if (currentTask) parts.push(`Tarea actual: ${currentTask}.`);

    return parts.length ? `Contexto de la sesión actual — ${parts.join(" ")}` : undefined;
  }
}

/**
 * Solo para mostrar (el `content` de un mensaje "tool") — lo que
 * efectivamente vuelve al LLM en la próxima ronda es `Message.toolResult`
 * completo (`data` real incluido), sin pasar por acá (ver `GeminiProvider`
 * y equivalentes: mapean `toolResult`, no `content`). Por eso es seguro
 * traducir esto a una frase humana sin perderle al modelo el dato real.
 */
function summarizeToolResult(name: string, result: { success: boolean; data?: unknown; error?: string }): string {
  return translateToolResult(name, result.success, result.error);
}
