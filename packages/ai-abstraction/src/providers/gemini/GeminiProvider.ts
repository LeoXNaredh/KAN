import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclarationSchema,
} from "@google/generative-ai";
import type { AIProviderPort, ChatRequest, ChatResponse, Message } from "@kan/core";
import type { ToolDescriptor } from "@kan/plugin-contract";

export interface GeminiProviderConfig {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = "gemini-2.0-flash";

export class GeminiProvider implements AIProviderPort {
  readonly providerName = "gemini";

  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(config: GeminiProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "GeminiProvider: falta la API key. Define GEMINI_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.modelName = config.model ?? DEFAULT_MODEL;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: request.systemPrompt,
      tools: request.tools?.length
        ? [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }]
        : undefined,
    });

    const contents = request.messages.map(toGeminiContent);

    const result = await model.generateContent({ contents });
    const calls = result.response.functionCalls();

    if (calls?.length) {
      return { toolCalls: calls.map((call) => ({ name: call.name, args: call.args })) };
    }

    return { content: result.response.text() };
  }
}

function toGeminiContent(message: Message): Content {
  if (message.role === "tool" && message.toolResult) {
    return {
      role: "function",
      parts: [
        {
          functionResponse: {
            name: message.toolResult.name,
            response: { result: message.toolResult },
          },
        },
      ],
    };
  }

  if (message.role === "assistant" && message.toolCall) {
    return {
      role: "model",
      parts: [{ functionCall: { name: message.toolCall.name, args: message.toolCall.args as object } }],
    };
  }

  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

function toFunctionDeclaration(tool: ToolDescriptor) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.inputSchema),
  };
}

/**
 * Convierte el `inputSchema` informal de CapabilityDescriptor (ej.
 * `{ distanceMm: "number" }`) al esquema real que exige el SDK de Gemini.
 * Validación de JSON Schema completa queda deferida (docs/04, docs/12 §5).
 */
function toGeminiSchema(inputSchema: Record<string, unknown> | undefined): FunctionDeclarationSchema | undefined {
  if (!inputSchema || Object.keys(inputSchema).length === 0) return undefined;

  const properties: Record<string, { type: SchemaType }> = {};
  for (const [key, value] of Object.entries(inputSchema)) {
    properties[key] = { type: mapSchemaType(value) };
  }

  return { type: SchemaType.OBJECT, properties };
}

function mapSchemaType(value: unknown): SchemaType {
  const hint = String(value).toLowerCase();
  if (hint === "boolean") return SchemaType.BOOLEAN;
  if (hint === "number" || hint === "integer") return SchemaType.NUMBER;
  return SchemaType.STRING;
}
