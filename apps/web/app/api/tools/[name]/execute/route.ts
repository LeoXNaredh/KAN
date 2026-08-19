import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/**
 * Nace para el constructor visual de secuencias (/secuencias): ejecutar
 * kan_run_sequence ahora mismo, crear/cancelar/listar alertas con
 * kan_set_alert/kan_cancel_alert/kan_list_alerts — todas ya despachadas por
 * `Gateway.executeTool()`, mismo POST /v1/tools/:name/execute que ya existe.
 * Allowlist a propósito (nunca "cualquier tool"): esta ruta no busca ser un
 * "ejecutar cualquier capability desde el browser" genérico — eso es una
 * superficie distinta, no pedida acá.
 */
const ALLOWED_TOOLS = new Set(["kan_run_sequence", "kan_set_alert", "kan_cancel_alert", "kan_list_alerts"]);

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!ALLOWED_TOOLS.has(name)) {
    return NextResponse.json({ error: `Tool no permitida desde esta pantalla: "${name}".` }, { status: 400 });
  }

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/tools/${encodeURIComponent(name)}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userToken ? { "X-User-Token": userToken } : {}) },
      body: JSON.stringify({ args: body?.args ?? {} }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo ejecutar la acción." }, { status: response.status });
    }

    // kan_list_alerts no filtra por dueño del lado del Gateway (a diferencia
    // del resto de las tools) — se compensa acá, antes de que le llegue a
    // ningún cliente, sin tocar packages/gateway-core.
    if (name === "kan_list_alerts" && data?.success && Array.isArray(data?.data?.alerts)) {
      const alerts = (data.data.alerts as Array<{ createdBy?: string }>).filter(
        (alert) => alert.createdBy === auth.user.userId,
      );
      return NextResponse.json({ ...data, data: { ...data.data, alerts } });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
