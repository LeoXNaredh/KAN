export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
  createdAt: string;
}

export function createMessage(role: MessageRole, content: string): Message {
  return { role, content, createdAt: new Date().toISOString() };
}
