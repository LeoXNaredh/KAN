import {
  InMemoryConversationRepository,
  SendMessageUseCase,
  UserScopedMemoryContext,
  type AIProviderPort,
  type ToolProviderPort,
} from "@kan/core";
import { SupabaseConversationRepository, SupabaseMemoryStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

// Compartido entre requests sin sesión (o sin Supabase configurado
// todavía) — mismo fallback que existía antes de P0.2, para que el chat
// nunca dependa de tener credenciales reales para funcionar en local.
const fallbackConversationRepository = new InMemoryConversationRepository();

/**
 * Composition root del chat (P0.2): si hay sesión, usa persistencia real en
 * Supabase (conversaciones + memoria); si no, cae al repositorio en memoria
 * de siempre, sin memoria — el chat sigue funcionando en ambos casos.
 */
export async function buildSendMessageUseCase(
  aiProvider: AIProviderPort,
  toolProvider?: ToolProviderPort,
): Promise<SendMessageUseCase> {
  const user = await getCurrentUserCached();

  if (!user) {
    return new SendMessageUseCase(aiProvider, fallbackConversationRepository, toolProvider);
  }

  const client = await createSupabaseServerClient();
  const conversationRepository = new SupabaseConversationRepository(client, user.userId);
  const memoryContext = new UserScopedMemoryContext(new SupabaseMemoryStore(client), user.userId);

  return new SendMessageUseCase(aiProvider, conversationRepository, toolProvider, memoryContext);
}
