import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";

export class DeleteConversationUseCase {
  constructor(private readonly conversationRepository: ConversationRepositoryPort) {}

  async execute(id: string): Promise<void> {
    await this.conversationRepository.delete(id);
  }
}
