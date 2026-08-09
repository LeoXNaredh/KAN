import type { AIProviderPort, ChatRequest, ChatResponse, Message } from "@kan/core";
import type { ToolDescriptor } from "@kan/plugin-contract";

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
}

// Catálogo de modelos puede cambiar — si esto empieza a fallar con 404,
// revisar https://docs.anthropic.com/en/docs/about-claude/models
const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
// Anthropic exige `max_tokens` en cada request (a diferencia de Gemini/
// OpenAI, que tienen default implícito) — no es una elección de KAN, es un
// campo obligatorio de su API.
const MAX_TOKENS = 4096;

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock | AnthropicImageBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: ToolDescriptor["inputSchema"];
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
}

/**
 * Adaptador de AIProviderPort sobre la API de Anthropic — fetch directo,
 * sin SDK (mismo criterio que ADR-011: se reevalúa el día que mapear cada
 * proveedor a mano empiece a doler de verdad, no antes). Solo implementa
 * `chat`, no todo `AIProviderPort` — `providerName` vive igual como campo
 * de instancia porque `ModelRouter` lo necesita para loguear qué proveedor
 * respondió, pero no es parte del contrato mínimo exigido acá.
 */
export class AnthropicProvider implements Pick<AIProviderPort, "chat"> {
  readonly providerName = "anthropic";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "AnthropicProvider: falta la API key. Define ANTHROPIC_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: request.systemPrompt,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools?.length ? request.tools.map(toAnthropicTool) : undefined,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Anthropic respondió ${response.status} al chatear: ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    const toolUseBlocks = data.content.filter(
      (block): block is AnthropicToolUseBlock => block.type === "tool_use",
    );
    if (toolUseBlocks.length) {
      return {
        toolCalls: toolUseBlocks.map((block) => ({
          name: block.name,
          args: block.input,
          // El id que Anthropic asignó a este tool_use — se reenvía tal
          // cual en el tool_result de la siguiente ronda (ver
          // toAnthropicMessages/toolUseId más abajo), igual patrón que el
          // thought signature de Gemini.
          providerMetadata: block.id,
        })),
      };
    }

    const textBlocks = data.content.filter((block): block is AnthropicTextBlock => block.type === "text");
    return { content: textBlocks.map((block) => block.text).join("") };
  }
}

/**
 * El `id` de un tool_use — si el mensaje lo trae en `providerMetadata`
 * (lo asignó Anthropic en una respuesta anterior), se reusa tal cual;
 * si no (ej. replay de una conversación que arrancó con Gemini, que no
 * genera este id), se genera uno estable derivado del índice. Anthropic
 * solo exige que el id sea consistente DENTRO de la misma request que se
 * manda — no que coincida con nada que Anthropic haya visto antes.
 */
function toolUseId(message: Message, index: number): string {
  return (message.toolCall?.providerMetadata as string | undefined) ?? `toolu_${index}`;
}

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  return messages.map((message, index) => {
    if (message.role === "tool" && message.toolResult) {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId(messages[index - 1], index - 1),
            content: JSON.stringify(message.toolResult),
            is_error: !message.toolResult.success,
          },
        ],
      };
    }

    if (message.role === "assistant" && message.toolCall) {
      const content: AnthropicContentBlock[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      content.push({
        type: "tool_use",
        id: toolUseId(message, index),
        name: message.toolCall.name,
        input: message.toolCall.args ?? {},
      });
      return { role: "assistant", content };
    }

    const content: AnthropicContentBlock[] = [{ type: "text", text: message.content }];
    if (message.image) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: message.image.mimeType, data: message.image.data },
      });
    }
    return { role: message.role === "assistant" ? "assistant" : "user", content };
  });
}

export function toAnthropicTool(tool: ToolDescriptor): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    // A diferencia de Gemini (parametersJsonSchema opcional), Anthropic
    // exige un input_schema válido siempre — un objeto vacío declara
    // "sin parámetros", nunca `undefined`.
    input_schema: Object.keys(tool.inputSchema ?? {}).length ? tool.inputSchema : { type: "object", properties: {} },
  };
}
