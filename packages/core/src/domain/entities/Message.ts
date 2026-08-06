import type { ToolCallProposal } from "@kan/plugin-contract";

export type MessageRole = "user" | "assistant" | "tool";

export interface ToolResultSummary {
  name: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Message {
  role: MessageRole;
  content: string;
  createdAt: string;
  /** Presente en mensajes "assistant" que propusieron invocar una tool. */
  toolCall?: ToolCallProposal;
  /** Presente en mensajes "tool" — el resultado que se le devuelve al LLM. */
  toolResult?: ToolResultSummary;
}

export function createMessage(role: MessageRole, content: string): Message {
  return { role, content, createdAt: new Date().toISOString() };
}
