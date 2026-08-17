import { NextResponse } from "next/server";
import { buildConversationsUseCases } from "@/lib/conversations/composition";
import { requireUser } from "@/lib/auth/requireUser";

/** Trae una conversación completa (para reabrirla desde el sidebar) — mismo gate de sesión que /api/conversations. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const { getConversation } = await buildConversationsUseCases(auth.user.userId);
    const conversation = await getConversation.execute(id);
    if (!conversation) return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error("[/api/conversations/[id]] error inesperado:", error);
    return NextResponse.json({ error: "No se pudo cargar la conversación." }, { status: 502 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const { deleteConversation } = await buildConversationsUseCases(auth.user.userId);
    await deleteConversation.execute(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/conversations/[id]] DELETE error:", error);
    return NextResponse.json({ error: "No se pudo borrar la conversación." }, { status: 502 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let title: string;

  try {
    const body = await request.json();
    title = body.title;
    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Título inválido." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  try {
    const { renameConversation } = await buildConversationsUseCases(auth.user.userId);
    await renameConversation.execute(id, title);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/conversations/[id]] PATCH error:", error);
    return NextResponse.json({ error: "No se pudo renombrar la conversación." }, { status: 502 });
  }
}
