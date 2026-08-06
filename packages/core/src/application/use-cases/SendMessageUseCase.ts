import { appendMessage, createConversation, type Conversation } from "../../domain/entities/Conversation";
import { createMessage } from "../../domain/entities/Message";
import type { AIProviderPort } from "../../domain/ports/AIProviderPort";
import type { ConversationRepositoryPort } from "../../domain/ports/ConversationRepositoryPort";

const SYSTEM_PROMPT =
  "Eres KAN, un asistente de IA que en el futuro podrá controlar dispositivos físicos " +
  "(impresoras 3D, CNC, robots, microcontroladores) a través de plugins. Por ahora solo " +
  "puedes conversar: sé claro, conciso y honesto sobre qué puedes y no puedes hacer todavía.";

export interface SendMessageInput {
  conversationId?: string;
  userMessage: string;
}

export interface SendMessageOutput {
  conversation: Conversation;
}

export class SendMessageUseCase {
  constructor(
    private readonly aiProvider: AIProviderPort,
    private readonly conversationRepository: ConversationRepositoryPort,
  ) {}

  async execute(input: SendMessageInput): Promise<SendMessageOutput> {
    const conversation = input.conversationId
      ? (await this.conversationRepository.getById(input.conversationId)) ?? createConversation()
      : createConversation();

    const withUserMessage = appendMessage(conversation, createMessage("user", input.userMessage));

    const { content } = await this.aiProvider.chat({
      messages: withUserMessage.messages,
      systemPrompt: SYSTEM_PROMPT,
    });

    const withAssistantMessage = appendMessage(withUserMessage, createMessage("assistant", content));

    await this.conversationRepository.save(withAssistantMessage);

    return { conversation: withAssistantMessage };
  }
}
