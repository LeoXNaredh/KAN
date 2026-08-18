import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * Resuelve una confirmación de la bandeja (requisito: aprobarla/cancelarla
 * fuera del chat) — proxy directo sobre POST /v1/confirmations/:id/resolve
 * del Gateway, el mismo endpoint que ya usa el flujo de chat
 * (`GatewayToolProvider.resolveConfirmation()`), acá invocado sin pasar por
 * ninguna conversación: la bandeja no tiene un `conversationId` al que
 * atar esto, ni falta hace — es la misma acción física, resuelta igual.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body?.approved !== "boolean") {
    return NextResponse.json({ error: "Se requiere 'approved' como boolean." }, { status: 400 });
  }

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/confirmations/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userToken ? { "X-User-Token": userToken } : {}) },
      body: JSON.stringify({ approved: body.approved }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo resolver la confirmación." }, { status: response.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
