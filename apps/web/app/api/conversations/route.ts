import { NextResponse } from "next/server";
import { buildConversationsUseCases } from "@/lib/conversations/composition";
import { requireUser } from "@/lib/auth/requireUser";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/**
 * Lista de "chats guardados" para el sidebar (ADR — chats como en
 * Claude/ChatGPT) — BFF fino sobre ListConversationsUseCase, mismo patrón
 * que /api/jobs. `limit` en query string es opcional, el sidebar solo pide
 * las últimas 5, pero no hay motivo para fijarlo en el use case.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const { listConversations } = await buildConversationsUseCases(auth.user.userId);
    const conversations = await listConversations.execute(limit);
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("[/api/conversations] error inesperado:", error);
    return NextResponse.json({ conversations: [] });
  }
}
