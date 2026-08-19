import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";
import type { SensorSummaryView } from "@/lib/sensores/types";

/**
 * Catálogo de sensores conocidos (dashboard /sensores) — proxy fino sobre
 * GET /v1/telemetry del Gateway, mismo patrón que /api/capabilities.
 * Incluye sensores de dispositivos ya desconectados (con su última lectura
 * conocida) además de los actualmente conectados — `connected` distingue
 * unos de otros, ya resuelto del lado del Gateway.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/telemetry", { headers: userToken ? { "X-User-Token": userToken } : {} });
    if (!response.ok) return NextResponse.json({ sensors: [] });
    const body = (await response.json()) as { sensors: SensorSummaryView[] };
    return NextResponse.json({ sensors: body.sensors ?? [] });
  } catch {
    return NextResponse.json({ sensors: [] });
  }
}
