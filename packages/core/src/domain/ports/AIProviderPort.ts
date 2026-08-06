import type { Message } from "../entities/Message";

export interface ChatRequest {
  messages: Message[];
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
}

export interface AIProviderPort {
  readonly providerName: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
