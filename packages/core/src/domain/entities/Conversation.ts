import { randomUUID } from "node:crypto";
import type { Message } from "./Message";

export interface Conversation {
  id: string;
  title?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export function createConversation(): Conversation {
  const now = new Date().toISOString();
  return { id: randomUUID(), messages: [], createdAt: now, updatedAt: now };
}

export function appendMessage(conversation: Conversation, message: Message): Conversation {
  return {
    ...conversation,
    messages: [...conversation.messages, message],
    updatedAt: new Date().toISOString(),
  };
}

/** Vista liviana para listar conversaciones (sidebar "chats") — sin `messages`, evita traer el historial completo solo para mostrar un título. */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const MAX_TITLE_LENGTH = 40;

/**
 * Título derivado on-the-fly de la primera línea del primer mensaje (siempre
 * el primer `user` de la conversación, ver `SendMessageUseCase.execute` —
 * agrega el mensaje del usuario antes que cualquier otro) — no se persiste
 * una columna `title` aparte para no tener que mantenerla sincronizada.
 */
export function deriveConversationTitle(firstUserMessage: string | undefined): string {
  const firstLine = firstUserMessage?.split("\n")[0]?.trim();
  if (!firstLine) return "Nueva conversación";
  return firstLine.length > MAX_TITLE_LENGTH ? `${firstLine.slice(0, MAX_TITLE_LENGTH).trimEnd()}…` : firstLine;
}
