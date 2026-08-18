import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * BFF de la bandeja de confirmaciones pendientes (requisito: verlas/
 * aprobarlas fuera del chat que las disparó, ej. una secuencia de una
 * alerta sin conversación activa) — proxy fino sobre GET /v1/confirmations
 * del Gateway, mismo criterio que /api/jobs (sin traducción: la forma que
 * ya devuelve el Gateway es apta para el cliente tal cual).
 */
export async function GET(request: Request) {
  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/confirmations", { headers: userToken ? { "X-User-Token": userToken } : {} });
    if (!response.ok) return NextResponse.json({ confirmations: [] });
    const data = (await response.json()) as { confirmations?: unknown };
    return NextResponse.json({ confirmations: data.confirmations ?? [] });
  } catch {
    // KAN debe seguir mostrándose aunque el Gateway esté apagado — mismo criterio que /api/status.
    return NextResponse.json({ confirmations: [] });
  }
}
