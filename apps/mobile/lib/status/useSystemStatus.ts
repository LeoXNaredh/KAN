import { useEffect, useState } from "react";
import { getAccessToken } from "../supabase/getAccessToken";
import type { SystemStatusResponse } from "./types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
const POLL_INTERVAL_MS = 15_000;

/**
 * Mismo contrato que apps/web/lib/status/useSystemStatus.ts (docs/18,
 * incremento 6). Desde P2 incremento 2 (docs/19) manda el access_token
 * igual que `/api/chat` (ADR-029) — `apps/web` lo reenvía al Gateway como
 * `X-User-Token`, aunque todavía no lo exige. Fetch plano (no `expo/fetch`):
 * esta llamada es JSON simple, sin streaming ni FormData, así que no
 * necesita ninguna de las capacidades que justificaron usar `expo/fetch`
 * (ADR-027) ni `XMLHttpRequest` (ADR-032) en otros lugares de la app.
 */
export function useSystemStatus(): { status: SystemStatusResponse | null; loading: boolean } {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const accessToken = await getAccessToken();
        const response = await fetch(`${API_BASE_URL}/api/status`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });
        if (!response.ok) return;
        const data = (await response.json()) as SystemStatusResponse;
        if (!cancelled) setStatus(data);
      } catch {
        // El Dashboard debe seguir mostrándose aunque /api/status falle.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { status, loading };
}
