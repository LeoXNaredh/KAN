import { randomUUID } from "node:crypto";
import type { Message } from "./Message";

export interface Conversation {
  id: string;
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
