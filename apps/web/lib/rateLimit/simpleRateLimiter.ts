interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, RateLimitEntry>();

// Barrido oportunista (no un `setInterval` propio, que necesitaría su
// propio cleanup en shutdown) — cada `SWEEP_INTERVAL_CALLS` llamadas, tira
// las entradas cuya ventana ya venció, para que un usuario que mandó un
// solo mensaje y nunca volvió no quede ocupando memoria para siempre.
const SWEEP_INTERVAL_CALLS = 500;
let callsSinceSweep = 0;

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos hasta poder reintentar — solo presente si `allowed` es false. */
  retryAfterSec?: number;
}

/**
 * Ventana fija en memoria, por key (fix de auditoría de backend #2) — mismo
 * criterio de simplicidad que el resto del proyecto: sin Redis ni infra
 * externa, igual que el `express-rate-limit` en memoria que ya usa
 * apps/gateway/src/http/routes.ts (ADR-025). Válido para un único proceso
 * de servidor; en un deploy con múltiples instancias sin sticky sessions,
 * cada instancia lleva su propio conteo (el límite real termina siendo
 * `limit * instancias`, no un límite global exacto) — aceptable al volumen
 * actual, documentado acá para quien escale esto más adelante.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_INTERVAL_CALLS) {
    callsSinceSweep = 0;
    sweepStale(windowMs);
  }

  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count < limit) {
    entry.count += 1;
    return { allowed: true };
  }

  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)) };
}

function sweepStale(windowMs: number): void {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart >= windowMs) buckets.delete(key);
  }
}

/** Solo para tests — el estado del módulo es compartido entre requests a propósito, así que los tests necesitan poder resetearlo. */
export function __resetRateLimitStateForTests(): void {
  buckets.clear();
  callsSinceSweep = 0;
}
