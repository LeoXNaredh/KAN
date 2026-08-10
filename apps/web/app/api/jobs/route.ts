import { NextResponse } from "next/server";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import type { JobsListResponse, ScheduledJobView } from "@/lib/jobs/types";

/**
 * BFF de automatizaciones (P6): proxy fino sobre GET/POST /v1/jobs del
 * Gateway — sin traducción como /api/status, porque ScheduledJob ya es un
 * shape apto para el cliente. `gatewayOnline` permite a la UI distinguir
 * "sin automatizaciones todavía" de "no se pudo consultar al Gateway".
 */
export async function GET(request: Request) {
  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/jobs", { headers: userToken ? { "X-User-Token": userToken } : {} });
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

  const rawSteps = Array.isArray(body?.steps) ? body.steps : [];
  const steps: Array<{ capabilityRef: string; input: unknown }> = [];
  for (const rawStep of rawSteps) {
    const capabilityRef = typeof rawStep?.capabilityRef === "string" ? rawStep.capabilityRef.trim() : "";
    if (!capabilityRef) {
      return NextResponse.json({ error: "Cada paso ('steps') necesita 'capabilityRef'." }, { status: 400 });
    }
    steps.push({ capabilityRef, input: rawStep?.input ?? {} });
  }
  if (steps.length === 0) {
    return NextResponse.json({ error: "El job necesita al menos un paso ('steps')." }, { status: 400 });
  }

  const cron = typeof body?.cron === "string" && body.cron.trim() ? body.cron.trim() : undefined;
  const runAt = typeof body?.runAt === "string" && body.runAt.trim() ? body.runAt.trim() : undefined;
  if ((cron && runAt) || (!cron && !runAt)) {
    return NextResponse.json({ error: "Elegí exactamente un tipo de programación: cron o una vez." }, { status: 400 });
  }

  const rawNotification = body?.notification;
  const notification =
    rawNotification && typeof rawNotification.title === "string" && typeof rawNotification.body === "string" && rawNotification.title.trim() && rawNotification.body.trim()
      ? { title: rawNotification.title.trim(), body: rawNotification.body.trim() }
      : undefined;

  try {
    const userToken = await resolveUserToken(request);
    const response = await gatewayFetch("/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userToken ? { "X-User-Token": userToken } : {}) },
      body: JSON.stringify({ steps, notification, cron, runAt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? "No se pudo programar el recordatorio." }, { status: response.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "KAN no está disponible en este momento." }, { status: 502 });
  }
}
