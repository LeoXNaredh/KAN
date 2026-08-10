import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

interface RawTool {
  name: string;
  description: string;
}

/**
 * Catálogo de capabilities para el picker de /automatizaciones (P6) — no
 * expone `inputSchema` todavía (el formulario de creación usa un textarea
 * JSON libre, ver AutomatizacionesClient.tsx). Se degrada a lista vacía si
 * el Gateway está apagado, mismo criterio que /api/status.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/tools", { headers: userToken ? { "X-User-Token": userToken } : {} });
    if (!response.ok) return NextResponse.json({ tools: [] });
    const body = (await response.json()) as { tools: RawTool[] };
    return NextResponse.json({ tools: body.tools.map((tool) => ({ name: tool.name, description: tool.description })) });
  } catch {
    return NextResponse.json({ tools: [] });
  }
}
