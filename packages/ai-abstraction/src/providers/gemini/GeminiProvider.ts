import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProviderPort, ChatRequest, ChatResponse } from "@kan/core";

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
    });

    const contents = request.messages.map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: message.content }],
    }));

    const result = await model.generateContent({ contents });
    return { content: result.response.text() };
  }
}
