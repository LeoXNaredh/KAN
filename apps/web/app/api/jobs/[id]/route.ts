import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * `X-User-Token` reenviado igual que en GET/POST /v1/jobs (`jobs/route.ts`)
 * — hoy no cambia si la cancelación se permite (`ScheduledJob` queda fuera
 * del alcance de autorización por owner a propósito, ADR-033), pero sí
 * queda el identity trail consistente para cuando eso se revise, y evita
 * la inconsistencia de mandar esta request sin ningún header de sesión
 * mientras las otras dos sí lo hacen.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    if (!response.ok && response.status !== 204) {
      return NextResponse.json({ error: "No se pudo cancelar el recordatorio en este momento." }, { status: 502 });
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
