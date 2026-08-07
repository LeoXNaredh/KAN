import { randomUUID } from "node:crypto";
import type { ToolCallProposal } from "@kan/plugin-contract";

export type MessageRole = "user" | "assistant" | "tool";

export interface ToolResultSummary {
  name: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface MessageImage {
  /** Base64 sin el prefijo "data:...;base64," — ver ADR-018 en docs/00. */
  data: string;
  mimeType: string;
}

export interface Message {
  /** Estable desde la creación — permite upsert idempotente en el adaptador de persistencia (P0.2). */
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** Presente en mensajes "assistant" que propusieron invocar una tool. */
  toolCall?: ToolCallProposal;
  /** Presente en mensajes "tool" — el resultado que se le devuelve al LLM. */
  toolResult?: ToolResultSummary;
  /** Presente en mensajes "user" que adjuntaron una imagen (P3, ADR-018). */
  image?: MessageImage;
}

export function createMessage(role: MessageRole, content: string, image?: MessageImage): Message {
  return { id: randomUUID(), role, content, createdAt: new Date().toISOString(), image };
}
