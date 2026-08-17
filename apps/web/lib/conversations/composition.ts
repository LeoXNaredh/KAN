import { ListConversationsUseCase, GetConversationUseCase, DeleteConversationUseCase, RenameConversationUseCase } from "@kan/core";
import { SupabaseConversationRepository } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Composition root de "chats guardados" (sidebar) — mismo rol que
 * lib/projects/composition.ts. A diferencia de lib/chat/composition.ts (que
 * cae a un repositorio en memoria para permitir chatear sin sesión), acá se
 * requiere un usuario real: listar/releer historial es una operación sobre
 * datos persistidos del usuario, no algo con sentido para una sesión
 * anónima efímera. Los route handlers que llaman a esto ya filtran con
 * requireUser() antes.
 */
export async function buildConversationsUseCases(userId: string) {
  const client = await createSupabaseServerClient();
  const conversationRepository = new SupabaseConversationRepository(client, userId);

  return {
    listConversations: new ListConversationsUseCase(conversationRepository),
    getConversation: new GetConversationUseCase(conversationRepository),
    deleteConversation: new DeleteConversationUseCase(conversationRepository),
    renameConversation: new RenameConversationUseCase(conversationRepository),
  };
}
