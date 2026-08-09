import {
  GetCurrentUserUseCase,
  InMemoryConversationRepository,
  SendMessageUseCase,
  SessionContext,
  UserScopedMemoryContext,
  UserScopedPersonalityContext,
  type AIProviderPort,
  type ToolProviderPort,
  type UserIdentity,
} from "@kan/core";
import { SupabaseAuthAdapter, SupabaseConversationRepository, SupabaseMemoryStore, SupabaseUserPreferencesStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

// Compartido entre requests sin sesión (o sin Supabase configurado
// todavía) — mismo fallback que existía antes de P0.2, para que el chat
// nunca dependa de tener credenciales reales para funcionar en local.
const fallbackConversationRepository = new InMemoryConversationRepository();

/**
 * ADR-029 (docs/00): resuelve el usuario a partir del `access_token` de un
 * cliente sin cookies (ej. la app móvil, roadmap P7) — nunca lanza, mismo
 * criterio que `getCurrentUserCached()` ("sin sesión" ante cualquier fallo).
 * El cliente de Supabase construido acá sirve igual para validar un JWT
 * explícito: `auth.getUser(token)` no consulta la sesión implícita del
 * cliente cuando se le pasa un token.
 */
async function getUserFromAccessToken(accessToken: string): Promise<UserIdentity | undefined> {
  try {
    const client = await createSupabaseServerClient();
    const authPort = new SupabaseAuthAdapter(client);
    return await new GetCurrentUserUseCase(authPort).execute(accessToken);
  } catch {
    return undefined;
  }
}

/**
 * Composition root del chat (P0.2): si hay sesión, usa persistencia real en
 * Supabase (conversaciones + memoria); si no, cae al repositorio en memoria
 * de siempre, sin memoria — el chat sigue funcionando en ambos casos.
 *
 * `accessToken` (ADR-029): un cliente sin cookies (app móvil) lo manda por
 * `Authorization: Bearer <token>` — si viene, se usa en vez de las cookies
 * de siempre; el camino de `apps/web` (sin `accessToken`) no cambia.
 */
export async function buildSendMessageUseCase(
  aiProvider: AIProviderPort,
  toolProvider?: ToolProviderPort,
  accessToken?: string,
): Promise<SendMessageUseCase> {
  const user = accessToken ? await getUserFromAccessToken(accessToken) : await getCurrentUserCached();

  if (!user) {
    return new SendMessageUseCase(aiProvider, fallbackConversationRepository, toolProvider);
  }

  const client = await createSupabaseServerClient();
  const conversationRepository = new SupabaseConversationRepository(client, user.userId);
  const memoryContext = new UserScopedMemoryContext(new SupabaseMemoryStore(client), user.userId);
  const personalityContext = new UserScopedPersonalityContext(new SupabaseUserPreferencesStore(client), user.userId);
  // ADR-055: en memoria, no Supabase — "en qué está trabajando el usuario
  // ahora" no necesita sobrevivir un restart del proceso, a diferencia de
  // memoryContext/personalityContext (esos sí son datos de largo plazo).
  const sessionContext = new SessionContext(user.userId);

  return new SendMessageUseCase(
    aiProvider,
    conversationRepository,
    toolProvider,
    memoryContext,
    personalityContext,
    sessionContext,
  );
}
