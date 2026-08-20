import { getAccessToken } from "../supabase/getAccessToken";
import type { AlertView } from "./types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/**
 * `/api/tools/kan_list_alerts/execute` y `/api/tools/kan_cancel_alert/execute`
 * (mismo patrón que lib/jobs/jobsApi.ts) — el mismo proxy allowlisted que ya
 * usa SecuenciasClient.tsx en apps/web (apps/web/app/api/tools/[name]/execute/route.ts).
 * El filtrado "solo mis alertas" ya lo hace esa ruta del lado de apps/web
 * (compara `alert.createdBy` contra la sesión), no hace falta repetirlo acá.
 */
async function authHeaders(): Promise<HeadersInit> {
  const accessToken = await getAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function listAlerts(): Promise<{ alerts: AlertView[]; gatewayOnline: boolean }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tools/kan_list_alerts/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ args: {} }),
    });
    if (!response.ok) return { alerts: [], gatewayOnline: false };
    const data = await response.json();
    return { alerts: data?.data?.alerts ?? [], gatewayOnline: true };
  } catch {
    return { alerts: [], gatewayOnline: false };
  }
}

export async function cancelAlert(alertId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tools/kan_cancel_alert/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ args: { alertId } }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function formatAlertText(alert: AlertView): string {
  const comparatorText = alert.comparator === "above" ? "supere" : "baje de";
  const unitText = alert.unit ? ` ${alert.unit}` : "";
  const stepsText = alert.steps && alert.steps.length > 0
    ? ` — y ejecuta ${alert.steps.length} paso${alert.steps.length > 1 ? "s" : ""}`
    : "";
  return `Avisa cuando ${alert.label} ${comparatorText} ${alert.threshold}${unitText}${stepsText}`;
}
