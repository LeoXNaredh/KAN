import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/**
 * Lista de snapshots de backup/restore de proyecto (docs/06) — proxy fino
 * sobre `GET /v1/snapshots` (todos) o `GET /v1/devices/:deviceId/snapshots`
 * (uno solo, con `?deviceId=`), mismo patrón que /api/capabilities. Se
 * degrada a `{ snapshots: [] }` si el Gateway está caído, mismo criterio
 * que /api/status/api/capabilities.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const deviceId = new URL(request.url).searchParams.get("deviceId");
  const path = deviceId ? `/v1/devices/${encodeURIComponent(deviceId)}/snapshots` : "/v1/snapshots";

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(path, { headers: userToken ? { "X-User-Token": userToken } : {} });
    if (!response.ok) return NextResponse.json({ snapshots: [] });
    const body = (await response.json()) as { snapshots?: unknown[] };
    return NextResponse.json({ snapshots: body.snapshots ?? [] });
  } catch {
    return NextResponse.json({ snapshots: [] });
  }
}
