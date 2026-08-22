import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/** "Ver contenido" de un snapshot 'source'/'config' (docs/06) — proxy sobre `GET /v1/snapshots/:id/content`. Nunca para 'binary' (el Gateway ya lo rechaza con 400). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/snapshots/${encodeURIComponent(id)}/content`, {
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo obtener el contenido del snapshot." }, { status: response.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}

/** Borra un snapshot — proxy sobre `DELETE /v1/snapshots/:id`. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/snapshots/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json({ error: data.error ?? "No se pudo borrar el snapshot." }, { status: response.status });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
