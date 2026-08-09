import type { AIProviderPort, ChatRequest, ChatResponse, Message } from "@kan/core";
import type { ToolDescriptor } from "@kan/plugin-contract";

export interface OpenAiProviderConfig {
  apiKey: string;
  model?: string;
}

// Catálogo de modelos puede cambiar — si esto empieza a fallar,
// revisar https://platform.openai.com/docs/models
const DEFAULT_MODEL = "gpt-4o";
const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OpenAiUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAiUserContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: ToolDescriptor["inputSchema"] };
}

interface OpenAiResponse {
  choices: Array<{ message: { content: string | null; tool_calls?: OpenAiToolCall[] } }>;
}

/**
 * Adaptador de AIProviderPort sobre la API de OpenAI (Chat Completions) —
 * fetch directo, sin SDK, mismo criterio que AnthropicProvider (ADR-011).
 */
export class OpenAiProvider implements Pick<AIProviderPort, "chat"> {
  readonly providerName = "openai";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: OpenAiProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "OpenAiProvider: falta la API key. Define OPENAI_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages: OpenAiMessage[] = request.systemPrompt
      ? [{ role: "system", content: request.systemPrompt }, ...toOpenAiMessages(request.messages)]
      : toOpenAiMessages(request.messages);

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: request.tools?.length ? request.tools.map(toOpenAiTool) : undefined,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenAI respondió ${response.status} al chatear: ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as OpenAiResponse;
    const message = data.choices[0]?.message;

    if (message?.tool_calls?.length) {
      return {
        toolCalls: message.tool_calls.map((call) => ({
          name: call.function.name,
          // OpenAI manda los argumentos como un string JSON, no un objeto.
          args: JSON.parse(call.function.arguments || "{}"),
          // El id que OpenAI asignó a este tool_call — se reenvía tal cual
          // en tool_call_id del tool result de la siguiente ronda.
          providerMetadata: call.id,
        })),
      };
    }

    return { content: message?.content ?? "" };
  }
}

/**
 * Mismo criterio que AnthropicProvider.toolUseId: reusa el id que OpenAI
 * asignó (guardado en providerMetadata) si existe, o genera uno estable
 * por índice para conversaciones que arrancaron con otro proveedor.
 */
function toolCallId(message: Message, index: number): string {
  return (message.toolCall?.providerMetadata as string | undefined) ?? `call_${index}`;
}

export function toOpenAiMessages(messages: Message[]): OpenAiMessage[] {
  return messages.map((message, index) => {
    if (message.role === "tool" && message.toolResult) {
      return {
        role: "tool",
        tool_call_id: toolCallId(messages[index - 1], index - 1),
        content: JSON.stringify(message.toolResult),
      };
    }

    if (message.role === "assistant" && message.toolCall) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: [
          {
            id: toolCallId(message, index),
            type: "function",
            function: { name: message.toolCall.name, arguments: JSON.stringify(message.toolCall.args ?? {}) },
          },
        ],
      };
    }

    if (message.image) {
      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: [
          { type: "text", text: message.content },
          { type: "image_url", image_url: { url: `data:${message.image.mimeType};base64,${message.image.data}` } },
        ],
      };
    }

    return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
  });
}

export function toOpenAiTool(tool: ToolDescriptor): OpenAiTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: Object.keys(tool.inputSchema ?? {}).length ? tool.inputSchema : { type: "object", properties: {} },
    },
  };
}
