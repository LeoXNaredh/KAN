import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ConversationRepositoryPort, Message, MessageRole } from "@kan/core";

interface ConversationRow {
  id: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  tool_call: unknown;
  tool_result: unknown;
  created_at: string;
  image_data: string | null;
  image_mime_type: string | null;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    createdAt: row.created_at,
    toolCall: (row.tool_call as Message["toolCall"]) ?? undefined,
    toolResult: (row.tool_result as Message["toolResult"]) ?? undefined,
    image: row.image_data && row.image_mime_type ? { data: row.image_data, mimeType: row.image_mime_type } : undefined,
  };
}

/**
 * Adaptador de ConversationRepositoryPort sobre `conversations`+`messages`
 * (ADR-017/P0.2). Construido con el cliente por-request y el userId ya
 * resuelto — cada operación filtra explícitamente por `user_id` además de
 * la RLS de la base (defensa en profundidad, mismo criterio que
 * SupabaseUserProfileAdapter).
 *
 * `save()` nunca reescribe un mensaje ya persistido (la tabla `messages` es
 * append-only por diseño — ver 0002_conversations_messages.sql, sin policy
 * de update): solo inserta los que todavía no existen para esa conversación.
 */
export class SupabaseConversationRepository implements ConversationRepositoryPort {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async getById(id: string): Promise<Conversation | undefined> {
    const { data: conversationRow, error: conversationError } = await this.client
      .from("conversations")
      .select("*")
      .eq("id", id)
      .eq("user_id", this.userId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversationRow) return undefined;

    const { data: messageRows, error: messagesError } = await this.client
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (messagesError) throw new Error(messagesError.message);

    const row = conversationRow as ConversationRow;
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: ((messageRows ?? []) as MessageRow[]).map(toMessage),
    };
  }

  async save(conversation: Conversation): Promise<void> {
    const { error: upsertError } = await this.client
      .from("conversations")
      .upsert({ id: conversation.id, user_id: this.userId, updated_at: conversation.updatedAt });
    if (upsertError) throw new Error(upsertError.message);

    const { data: existingRows, error: existingError } = await this.client
      .from("messages")
      .select("id")
      .eq("conversation_id", conversation.id);
    if (existingError) throw new Error(existingError.message);

    const existingIds = new Set(((existingRows ?? []) as Array<{ id: string }>).map((row) => row.id));
    const newMessages = conversation.messages.filter((message) => !existingIds.has(message.id));
    if (newMessages.length === 0) return;

    const { error: insertError } = await this.client.from("messages").insert(
      newMessages.map((message) => ({
        id: message.id,
        conversation_id: conversation.id,
        role: message.role,
        content: message.content,
        tool_call: message.toolCall ?? null,
        tool_result: message.toolResult ?? null,
        created_at: message.createdAt,
        image_data: message.image?.data ?? null,
        image_mime_type: message.image?.mimeType ?? null,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }
}
