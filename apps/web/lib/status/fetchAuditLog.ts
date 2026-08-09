import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import type { RawAuditEntry } from "./translateAuditEntry";

const AUDIT_TIMEOUT_MS = 5_000;

/**
 * Historial completo de auditoría (P1.3, /logs) — mismo endpoint que
 * app/api/status/route.ts pero sin recortar a los últimos 10. `undefined`
 * distingue "Gateway apagado/inalcanzable" de `[]` ("Gateway online, sin
 * actividad todavía") para que /logs pueda mostrar el estado correcto.
 */
export async function fetchAuditLog(userToken?: string): Promise<RawAuditEntry[] | undefined> {
  try {
    const response = await gatewayFetch(
      "/v1/audit",
      { headers: userToken ? { "X-User-Token": userToken } : {} },
      AUDIT_TIMEOUT_MS,
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { entries: RawAuditEntry[] };
    return body.entries;
  } catch {
    return undefined;
  }
}
