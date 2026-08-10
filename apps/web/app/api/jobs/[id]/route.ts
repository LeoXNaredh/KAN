import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * `X-User-Token` reenviado igual que en GET/POST /v1/jobs (`jobs/route.ts`)
 * — desde el fix de autorización de jobs por owner, el Gateway puede
 * devolver 403 acá si el recordatorio pertenece a otro usuario (`routes.ts`
 * en apps/gateway); se reenvía tal cual en vez de aplastarlo a un 502
 * genérico, para que la UI pueda distinguir "no te pertenece" de "el
 * Gateway está apagado".
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    if (response.status === 403) {
      return NextResponse.json({ error: "Ese recordatorio pertenece a otra cuenta." }, { status: 403 });
    }
    if (!response.ok && response.status !== 204) {
      return NextResponse.json({ error: "No se pudo cancelar el recordatorio en este momento." }, { status: 502 });
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
