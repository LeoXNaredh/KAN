import type { Conversation, ConversationSummary } from "../entities/Conversation";

export interface ConversationRepositoryPort {
  getById(id: string): Promise<Conversation | undefined>;
  save(conversation: Conversation): Promise<void>;
  /** Últimas `limit` conversaciones del usuario, más recientes primero (por `updatedAt`). */
  listRecent(limit: number): Promise<ConversationSummary[]>;
  delete(id: string): Promise<void>;
  updateTitle(id: string, title: string): Promise<void>;
}
