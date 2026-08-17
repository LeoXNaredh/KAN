import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";

export class RenameConversationUseCase {
  constructor(private readonly conversationRepository: ConversationRepositoryPort) {}

  async execute(id: string, title: string): Promise<void> {
    await this.conversationRepository.updateTitle(id, title);
  }
}
