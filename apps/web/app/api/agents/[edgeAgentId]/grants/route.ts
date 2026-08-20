import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/**
 * Acceso multi-usuario (invitar/listar) — proxy fino sobre
 * POST/GET /v1/agents/:edgeAgentId/grants del Gateway, que ya hace el
 * chequeo real de "sos el dueño" (`edge_agent_pairings`, no un campo que se
 * pueda desincronizar) — acá solo se valida la forma del body antes de
 * reenviar, mismo criterio que el resto de los BFF.
 */
export async function GET(request: Request, { params }: { params: Promise<{ edgeAgentId: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { edgeAgentId } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/agents/${encodeURIComponent(edgeAgentId)}/grants`, {
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    if (!response.ok) return NextResponse.json({ grants: [] });
    const data = await response.json();
    return NextResponse.json({ grants: data.grants ?? [] });
  } catch {
    return NextResponse.json({ grants: [] });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ edgeAgentId: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { edgeAgentId } = await params;
  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Se requiere 'email'." }, { status: 400 });
  }

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/agents/${encodeURIComponent(edgeAgentId)}/grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userToken ? { "X-User-Token": userToken } : {}) },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo invitar." }, { status: response.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
