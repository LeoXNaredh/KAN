// ADR-029 (docs/00): un cliente sin cookies (ej. la app móvil, roadmap P7)
// manda su sesión de Supabase como Authorization: Bearer <access_token> en
// vez de cookies — apps/web (con cookies) no manda este header y sigue
// exactamente igual.
export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}
