import type { Conversation, ConversationSummary } from "@kan/core";
import { getAccessToken } from "../supabase/getAccessToken";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

async function authHeaders(): Promise<HeadersInit> {
  const accessToken = await getAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Últimas conversaciones guardadas — mismo GET /api/conversations que ya usa el sidebar de apps/web. */
export async function listConversations(): Promise<ConversationSummary[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conversations`, { headers: await authHeaders() });
    if (!response.ok) return [];
    const data = await response.json();
    return data.conversations ?? [];
  } catch {
    return [];
  }
}

/** Conversación completa (para reabrirla en el chat) — mismo GET /api/conversations/:id que ya usa apps/web. */
export async function getConversation(id: string): Promise<Conversation | undefined> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conversations/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (!response.ok) return undefined;
    const data = await response.json();
    return data.conversation;
  } catch {
    return undefined;
  }
}
