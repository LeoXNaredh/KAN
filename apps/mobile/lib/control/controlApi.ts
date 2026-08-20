import { getAccessToken } from "../supabase/getAccessToken";
import type { ActionSeverity, DeviceCapabilitiesView } from "./types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

async function authHeaders(): Promise<HeadersInit> {
  const accessToken = await getAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Catálogo de dispositivos + capabilities — mismo GET /api/capabilities que ya usa /control y /secuencias en apps/web. */
export async function fetchDevices(): Promise<{ devices: DeviceCapabilitiesView[]; gatewayOnline: boolean }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/capabilities`, { headers: await authHeaders() });
    if (!response.ok) return { devices: [], gatewayOnline: false };
    const data = await response.json();
    return { devices: data.devices ?? [], gatewayOnline: true };
  } catch {
    return { devices: [], gatewayOnline: false };
  }
}

export type RunResult =
  | { type: "done" }
  | { type: "failed"; error: string }
  | {
      type: "confirmation";
      confirmationId: string;
      deviceId: string;
      capabilityName: string;
      input: unknown;
      severity: ActionSeverity;
    };

/**
 * Ejecuta una capability con un solo paso — mismo POST
 * /api/tools/kan_run_sequence/execute que ya usa ControlClient.tsx en
 * apps/web (mismo BFF, mismo allowlist). El Gateway decide si hace falta
 * confirmación explícita (irreversible-material/safety-critical) — nunca un
 * pre-check acá.
 */
export async function runCapability(ref: string, input: Record<string, unknown>): Promise<RunResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tools/kan_run_sequence/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ args: { steps: [{ capabilityRef: ref, input }] } }),
    });
    const data = await response.json();

    if (data?.requiresConfirmation) {
      const confirmationData = (data.data ?? {}) as {
        confirmationId: string;
        deviceId: string;
        capabilityName: string;
        input: unknown;
        severity: ActionSeverity;
      };
      return {
        type: "confirmation",
        confirmationId: confirmationData.confirmationId,
        deviceId: confirmationData.deviceId,
        capabilityName: confirmationData.capabilityName,
        input: confirmationData.input,
        severity: confirmationData.severity,
      };
    }

    const step = data?.data?.steps?.[0];
    if (step?.outcome === "done") return { type: "done" };
    return { type: "failed", error: step?.error ?? data?.error ?? "No se pudo ejecutar." };
  } catch {
    return { type: "failed", error: "KAN no está disponible en este momento." };
  }
}

/** POST /api/confirmations/:id/resolve — mismo endpoint que ya usa el modal de confirmaciones pendientes en apps/web. */
export async function resolveConfirmation(confirmationId: string, approved: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/confirmations/${encodeURIComponent(confirmationId)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ approved }),
    });
    const data = await response.json().catch(() => ({}));
    return { success: Boolean(data?.success), error: data?.error };
  } catch {
    return { success: false, error: "KAN no está disponible en este momento." };
  }
}
