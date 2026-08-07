import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import type { JobsListResponse, ScheduledJobView } from "@/lib/jobs/types";

/**
 * BFF de automatizaciones (P6): proxy fino sobre GET/POST /v1/jobs del
 * Gateway — sin traducción como /api/status, porque ScheduledJob ya es un
 * shape apto para el cliente. `gatewayOnline` permite a la UI distinguir
 * "sin automatizaciones todavía" de "no se pudo consultar al Gateway".
 */
export async function GET() {
  try {
    const response = await gatewayFetch("/v1/jobs");
    if (!response.ok) {
      const body: JobsListResponse = { jobs: [], gatewayOnline: false };
      return NextResponse.json(body);
    }
    const data = (await response.json()) as { jobs: ScheduledJobView[] };
    const body: JobsListResponse = { jobs: data.jobs, gatewayOnline: true };
    return NextResponse.json(body);
  } catch {
    const body: JobsListResponse = { jobs: [], gatewayOnline: false };
    return NextResponse.json(body);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const capabilityRef = typeof body?.capabilityRef === "string" ? body.capabilityRef.trim() : "";
  if (!capabilityRef) {
    return NextResponse.json({ error: "'capabilityRef' es requerido." }, { status: 400 });
  }

  const cron = typeof body?.cron === "string" && body.cron.trim() ? body.cron.trim() : undefined;
  const runAt = typeof body?.runAt === "string" && body.runAt.trim() ? body.runAt.trim() : undefined;
  if ((cron && runAt) || (!cron && !runAt)) {
    return NextResponse.json({ error: "Elegí exactamente un tipo de programación: cron o una vez." }, { status: 400 });
  }

  try {
    const response = await gatewayFetch("/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskRequest: { capabilityRef, input: body?.input ?? {} }, cron, runAt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "El Gateway rechazó el job." }, { status: response.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo contactar al Gateway. ¿Está corriendo?" }, { status: 502 });
  }
}
