import type { Conversation } from "../entities/Conversation";

export interface ConversationRepositoryPort {
  getById(id: string): Promise<Conversation | undefined>;
  save(conversation: Conversation): Promise<void>;
}
