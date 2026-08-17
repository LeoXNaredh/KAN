import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";
import type { Conversation } from "../../domain/entities/Conversation";

export class GetConversationUseCase {
  constructor(private readonly conversationRepository: ConversationRepositoryPort) {}

  execute(id: string): Promise<Conversation | undefined> {
    return this.conversationRepository.getById(id);
  }
}
