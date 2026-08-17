import { deriveConversationTitle, type Conversation, type ConversationSummary } from "../domain/entities/Conversation";
import type { ConversationRepositoryPort } from "../domain/ports/ConversationRepositoryPort";

/**
 * Adaptador temporal mientras no hay proyecto de Supabase (ver ADR-007 en docs/00).
 * Implementa el mismo puerto que usará el futuro adaptador de Supabase, así que
 * reemplazarlo no requiere tocar el dominio ni los casos de uso.
 */
export class InMemoryConversationRepository implements ConversationRepositoryPort {
  private readonly conversations = new Map<string, Conversation>();

  async getById(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async save(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async listRecent(limit: number): Promise<ConversationSummary[]> {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title ?? deriveConversationTitle(conversation.messages.find((m) => m.role === "user")?.content),
        updatedAt: conversation.updatedAt,
      }));
  }

  async delete(id: string): Promise<void> {
    this.conversations.delete(id);
  }

  async updateTitle(id: string, title: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation) {
      conversation.title = title;
      conversation.updatedAt = new Date().toISOString();
      this.conversations.set(id, conversation);
    }
  }
}
