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

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Título derivado on-the-fly de la primera línea del primer mensaje (siempre
 * el primer `user` de la conversación, ver `SendMessageUseCase.execute` —
 * agrega el mensaje del usuario antes que cualquier otro) — no se persiste
 * una columna `title` aparte para no tener que mantenerla sincronizada. Sin
 * mensajes todavía, cae a "Conversación · <fecha>" (fecha de creación) en
 * vez de un texto genérico — array de meses a mano (no
 * `toLocaleDateString`) para que el formato sea idéntico sin importar el
 * entorno donde corra (Node del server vs. lo que sea que tenga el ICU del
 * browser).
 */
export function deriveConversationTitle(firstUserMessage: string | undefined, createdAt: string): string {
  const firstLine = firstUserMessage?.split("\n")[0]?.trim();
  if (firstLine) {
    return firstLine.length > MAX_TITLE_LENGTH ? `${firstLine.slice(0, MAX_TITLE_LENGTH).trimEnd()}…` : firstLine;
  }
  // Métodos UTC (no locales): `createdAt` ya es un ISO en UTC, y `getDate()`
  // en vez de `getUTCDate()` corría el riesgo real de mostrar el día
  // anterior en cualquier servidor con huso horario al oeste de UTC.
  const date = new Date(createdAt);
  return `Conversación · ${date.getUTCDate()} ${MONTHS_ES[date.getUTCMonth()]}`;
}
