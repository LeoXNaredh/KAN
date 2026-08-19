import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/**
 * Lectura en vivo de sensores (dashboard /sensores, sondeado cada 5s) —
 * proxy sobre POST /v1/telemetry/poll del Gateway, que ya rechaza cualquier
 * ref que no sea una capability read-only sin ejecutarla (gate de seguridad
 * del lado del Gateway, ver routes.ts) — acá solo se valida la forma del
 * body antes de reenviar, mismo criterio que /api/jobs.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const refs: unknown = body?.refs;
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => typeof ref !== "string")) {
    return NextResponse.json({ error: "Se requiere 'refs': una lista no vacía de strings." }, { status: 400 });
  }

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/telemetry/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userToken ? { "X-User-Token": userToken } : {}) },
      body: JSON.stringify({ refs }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo leer los sensores." }, { status: response.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
