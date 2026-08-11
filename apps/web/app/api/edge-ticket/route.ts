import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * Proxy fino sobre POST /v1/edge-tickets del Gateway (mismo patrón que
 * /api/jobs, /api/tools): el navegador nunca ve `KAN_GATEWAY_INTERNAL_TOKEN`
 * (se queda dentro de `gatewayFetch`) ni `KAN_EDGE_TOKEN` (nunca sale del
 * Gateway) — este endpoint solo reenvía el ticket de un solo uso que el
 * Simulador del navegador usa para conectar al WS /edge.
 */
export async function POST(request: Request) {
  const userToken = await resolveUserToken(request);
  if (!userToken) {
    return NextResponse.json({ error: "No hay sesión activa." }, { status: 401 });
  }

  try {
    const response = await gatewayFetch("/v1/edge-tickets", {
      method: "POST",
      headers: { "X-User-Token": userToken },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "El Gateway rechazó el pedido de ticket." }, { status: response.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo contactar al Gateway. ¿Está corriendo?" }, { status: 502 });
  }
}
