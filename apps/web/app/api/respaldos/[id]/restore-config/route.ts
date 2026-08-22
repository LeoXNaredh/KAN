import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/** Restaura un snapshot tipo "config" — proxy sobre `POST /v1/snapshots/:id/restore-config`. Sin capability/severidad de por medio (no toca ningún dispositivo físico), la UI pide confirmación ella misma antes de llamar acá. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/snapshots/${encodeURIComponent(id)}/restore-config`, {
      method: "POST",
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo restaurar el snapshot." }, { status: response.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
