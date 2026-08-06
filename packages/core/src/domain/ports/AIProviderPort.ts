import type { ToolCallProposal, ToolDescriptor } from "@kan/plugin-contract";
import type { Message } from "../entities/Message";

export interface ChatRequest {
  messages: Message[];
  systemPrompt?: string;
  /** Tools disponibles para esta ronda — el proveedor solo puede proponerlas, nunca ejecutarlas. */
  tools?: ToolDescriptor[];
}

export interface ChatResponse {
  /** Puede faltar si el modelo solo propuso tool calls, sin texto. */
  content?: string;
  toolCalls?: ToolCallProposal[];
}

export interface AIProviderPort {
  readonly providerName: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
