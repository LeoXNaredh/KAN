const GATEWAY_URL = process.env.KAN_GATEWAY_URL ?? "http://localhost:8787";
const GATEWAY_TOKEN = process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Fetch autenticado al Gateway (docs/12 §10) — mismo host/token que ya usan
 * GatewayToolProvider y /api/status. Extraído acá porque /api/jobs y
 * /api/tools lo necesitan sin pasar por @kan/core: es proxy BFF puro (igual
 * criterio que /api/status), no lógica de negocio.
 */
export function gatewayFetch(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${GATEWAY_TOKEN}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}
