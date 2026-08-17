import type { Request } from "express";

/**
 * Extrae el `sub` (userId) de un JWT sin verificar la firma — no hace
 * falta: acá solo se usa para elegir un bucket de rate limit estable por
 * usuario, no para autorizar nada (eso lo sigue haciendo
 * `createUserAuthMiddleware` más abajo en la cadena, contra Supabase de
 * verdad). Si alguien manda un JWT con un `sub` falso, en el peor caso
 * termina compartiendo o teniendo su propio bucket — no rompe el límite de
 * nadie más ni evade el suyo de forma útil.
 */
function extractUserIdFromToken(token: string): string | undefined {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return undefined;
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Key generator del rate limiter (fix de auditoría de backend #4) — antes
 * keyed por `req.ip`, que es siempre la misma IP para todo el tráfico real
 * (apps/web es el único origen que habla con el Gateway hoy, por diseño:
 * ver comentario en routes.ts), así que toda la base de usuarios competía
 * por un único presupuesto de 120 req/min.
 *
 * Se decodifica el JWT acá mismo (no se espera a `createUserAuthMiddleware`,
 * que corre después del chequeo del token interno) para no reordenar esa
 * cadena — el rate limiter necesita seguir siendo lo primero que corre,
 * antes incluso del chequeo del token interno, para acotar fuerza bruta
 * contra ese secreto también (comentario original en routes.ts). Por eso
 * esto es una función sincrónica que solo lee el header, no un middleware
 * que dependa de `req.userId` ya resuelto.
 *
 * Con `X-User-Token`: bucket por userId (estable aunque el token rote) o,
 * si no se pudo decodificar, por el token crudo (sigue siendo estable por
 * sesión). Sin token: cae a `req.ip`, mismo comportamiento que antes.
 */
export function rateLimitKey(req: Request): string {
  const token = req.headers["x-user-token"];
  if (typeof token === "string" && token) {
    const userId = extractUserIdFromToken(token);
    return userId ? `user:${userId}` : `token:${token}`;
  }
  return `ip:${req.ip ?? "unknown"}`;
}
