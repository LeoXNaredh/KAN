import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/** Revocar acceso — proxy sobre DELETE /v1/agents/:edgeAgentId/grants/:userId, mismo criterio dueño-only verificado del lado del Gateway. */
export async function DELETE(request: Request, { params }: { params: Promise<{ edgeAgentId: string; userId: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { edgeAgentId, userId } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/agents/${encodeURIComponent(edgeAgentId)}/grants/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    if (!response.ok && response.status !== 204) {
      const data = await response.json().catch(() => ({}));
      return NextResponse.json({ error: data.error ?? "No se pudo revocar el acceso." }, { status: response.status });
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
