import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";
import type { ConversationSummary } from "../../domain/entities/Conversation";

export class ListConversationsUseCase {
  constructor(private readonly conversationRepository: ConversationRepositoryPort) {}

  execute(limit: number): Promise<ConversationSummary[]> {
    return this.conversationRepository.listRecent(limit);
  }
}
