import { getAccessToken } from "../supabase/getAccessToken";
import type { SensorSummaryView, TelemetryPollResult } from "./types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
// Mismo tope duro que ya aplica POST /v1/telemetry/poll del lado del
// Gateway (apps/gateway/src/http/routes.ts) — se corta acá también para no
// depender de que el servidor rechace un catálogo más grande.
const MAX_POLL_REFS = 30;

async function authHeaders(): Promise<HeadersInit> {
  const accessToken = await getAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Catálogo completo (conectados y no) — GET /api/telemetry, mismo proxy que ya usa /sensores en apps/web. */
export async function fetchSensors(): Promise<SensorSummaryView[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/telemetry`, { headers: await authHeaders() });
    if (!response.ok) return [];
    const data = await response.json();
    return data.sensors ?? [];
  } catch {
    return [];
  }
}

/** Lectura en vivo — POST /api/telemetry/poll. Refs que ya no resuelven a una capability conectada fallan rápido del lado del Gateway, no hace falta filtrarlas antes acá. */
export async function pollSensors(refs: string[]): Promise<TelemetryPollResult[]> {
  if (refs.length === 0) return [];
  try {
    const response = await fetch(`${API_BASE_URL}/api/telemetry/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ refs: refs.slice(0, MAX_POLL_REFS) }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.readings ?? [];
  } catch {
    return [];
  }
}
