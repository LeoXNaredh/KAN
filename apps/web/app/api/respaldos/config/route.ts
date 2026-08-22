import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { requireUser } from "@/lib/auth/requireUser";

/**
 * Nuevo snapshot tipo "config" (docs/06, Plataforma C: PLC/Modbus/OPC-UA) —
 * proxy sobre `POST /v1/devices/:deviceId/snapshots/config`. A diferencia de
 * source/binary, nunca pasa por el Edge Agent (el Gateway arma el snapshot
 * desde sus propias reglas de alerta), así que no hay ninguna capability que
 * invocar vía kan_run_sequence acá.
 */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const deviceId = body?.deviceId;
  if (typeof deviceId !== "string" || !deviceId) {
    return NextResponse.json({ error: "Falta 'deviceId'." }, { status: 400 });
  }

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch(`/v1/devices/${encodeURIComponent(deviceId)}/snapshots/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userToken ? { "X-User-Token": userToken } : {}) },
      body: JSON.stringify({
        deviceKind: body.deviceKind,
        deviceName: body.deviceName,
        edgeAgentId: body.edgeAgentId,
        label: body.label,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo guardar el snapshot." }, { status: response.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
