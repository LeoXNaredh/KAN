import type { Conversation } from "../domain/entities/Conversation";
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
}
