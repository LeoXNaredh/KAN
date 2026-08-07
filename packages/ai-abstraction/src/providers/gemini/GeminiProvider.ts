import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import type { AIProviderPort, ChatRequest, ChatResponse, Message } from "@kan/core";
import type { ToolDescriptor } from "@kan/plugin-contract";

export interface GeminiProviderConfig {
  apiKey: string;
  model?: string;
}

// El catálogo de modelos de Gemini rota rápido (gemini-2.0-flash retirado
// 2026-03-03; gemini-2.5-flash ya no disponible para keys nuevas a esta
// fecha). Si esto vuelve a fallar con 404 "no longer available" o 429
// "limit: 0", revisar https://ai.google.dev/gemini-api/docs/models y
// actualizar aquí o sobreescribir con GEMINI_MODEL en .env.local.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

/**
 * Usa el SDK oficial vigente `@google/genai` — el paquete anterior
 * `@google/generative-ai` está deprecado por Google (repo renombrado a
 * `deprecated-generative-ai-js`) y su formato de mensajes (role "function"
 * para respuestas de tools) ya no es aceptado por la API real: los roles
 * válidos hoy son "user"/"model", y una respuesta de tool viaja como
 * `{ role: "user", parts: [{ functionResponse }] }`.
 */
export class GeminiProvider implements AIProviderPort {
  readonly providerName = "gemini";

  private readonly client: GoogleGenAI;
  private readonly modelName: string;

  constructor(config: GeminiProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "GeminiProvider: falta la API key. Define GEMINI_API_KEY en tu .env.local (ver .env.example).",
      );
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.modelName = config.model ?? DEFAULT_MODEL;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const contents = request.messages.map(toGeminiContent);

    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents,
      config: {
        systemInstruction: request.systemPrompt,
        tools: request.tools?.length
          ? [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }]
          : undefined,
      },
    });

    // No usamos response.functionCalls (solo name/args) porque Gemini 3.x
    // exige reenviar el "thought signature" de cada functionCall en la
    // siguiente ronda o rechaza la request (400 "missing a thought_signature"
    // — ver https://ai.google.dev/gemini-api/docs/thinking#signatures). Ese
    // campo vive en el Part crudo, no en el FunctionCall simplificado.
    const functionCallParts = (response.candidates?.[0]?.content?.parts ?? []).filter(
      (part) => part.functionCall,
    );
    if (functionCallParts.length) {
      return {
        toolCalls: functionCallParts.map((part) => ({
          name: part.functionCall?.name ?? "",
          args: part.functionCall?.args ?? {},
          providerMetadata: part.thoughtSignature,
        })),
      };
    }

    return { content: response.text };
  }
}

export function toGeminiContent(message: Message): Content {
  if (message.role === "tool" && message.toolResult) {
    return {
      role: "user",
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
      parts: [
        {
          functionCall: {
            name: message.toolCall.name,
            args: (message.toolCall.args as Record<string, unknown>) ?? {},
          },
          // Reenviado tal cual, sin interpretarlo — ver ToolCallProposal.providerMetadata.
          thoughtSignature: message.toolCall.providerMetadata as string | undefined,
        },
      ],
    };
  }

  const parts: Content["parts"] = [{ text: message.content }];
  if (message.image) {
    parts.push({ inlineData: { mimeType: message.image.mimeType, data: message.image.data } });
  }

  return {
    role: message.role === "assistant" ? "model" : "user",
    parts,
  };
}

export function toFunctionDeclaration(tool: ToolDescriptor): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    // `inputSchema` ya es JSON Schema real desde docs/16 P1 — Gemini lo
    // acepta tal cual vía `parametersJsonSchema` (a diferencia del extinto
    // `parameters`, que exigía su propio dialecto reducido).
    parametersJsonSchema: Object.keys(tool.inputSchema ?? {}).length ? tool.inputSchema : undefined,
  };
}
