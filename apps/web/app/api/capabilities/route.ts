import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

interface RawCapability {
  ref: string;
  name: string;
  description: string;
  severity: string;
  supportsDryRun: boolean;
  inputSchema: unknown;
}

interface RawDevice {
  edgeAgentId: string;
  deviceId: string;
  deviceName: string;
  capabilities: RawCapability[];
}

/**
 * Catálogo de dispositivos + capacidades para el constructor visual de
 * secuencias (/secuencias) — proxy fino sobre `GET /v1/capabilities` del
 * Gateway, mismo patrón que /api/tools (auth + gatewayFetch), pero
 * agrupado por dispositivo en vez de aplanado: la UI necesita elegir
 * primero "qué dispositivo" y recién después "qué hacer con él". Se
 * degrada a `{ devices: [] }` si el Gateway está caído, mismo criterio que
 * /api/status/api/tools.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/capabilities", { headers: userToken ? { "X-User-Token": userToken } : {} });
    if (!response.ok) return NextResponse.json({ devices: [] });
    const body = (await response.json()) as { devices: RawDevice[] };
    return NextResponse.json({ devices: body.devices ?? [] });
  } catch {
    return NextResponse.json({ devices: [] });
  }
}
