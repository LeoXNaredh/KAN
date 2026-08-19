import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";
import type { TelemetryReadingView } from "@/lib/sensores/types";

/** Historial de un sensor puntual (gráfico de detalle) — proxy sobre GET /v1/telemetry/:ref/history. */
export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { ref } = await params;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/telemetry/${encodeURIComponent(ref)}/history`, {
      headers: userToken ? { "X-User-Token": userToken } : {},
    });
    if (!response.ok) return NextResponse.json({ readings: [] });
    const body = (await response.json()) as { readings: TelemetryReadingView[] };
    return NextResponse.json({ readings: body.readings ?? [] });
  } catch {
    return NextResponse.json({ readings: [] });
  }
}
