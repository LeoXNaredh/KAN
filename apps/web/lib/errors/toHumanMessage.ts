/**
 * Traduce mensajes de error crudos (Supabase auth en inglés, fetch/network,
 * lo que sea que un provider externo devuelva) a texto legible en español —
 * mismo espíritu que `translateAuditEntry()` en `app/api/status/route.ts`,
 * extendido a los otros puntos donde `error.message` llegaba directo a la
 * UI sin pasar por ningún filtro (login/signup, chat).
 */
const KNOWN_ERROR_PATTERNS: Array<{ match: RegExp; message: string }> = [
  { match: /invalid login credentials/i, message: "Email o contraseña incorrectos." },
  { match: /user already registered/i, message: "Ya existe una cuenta con ese email." },
  { match: /email not confirmed/i, message: "Confirmá tu email antes de iniciar sesión — revisá tu bandeja de entrada." },
  { match: /password should be at least/i, message: "La contraseña es demasiado corta." },
  { match: /rate limit|too many requests/i, message: "Demasiados intentos — esperá un momento y probá de nuevo." },
  {
    match: /failed to fetch|fetch failed|network ?error|ECONNREFUSED|ETIMEDOUT/i,
    message: "No se pudo conectar — revisá tu conexión y probá de nuevo.",
  },
];

const GENERIC_FALLBACK = "Ocurrió un error inesperado. Probá de nuevo en un momento.";

/** Mensajes muy largos, con trazas de stack o rutas de archivo no son para el usuario final. */
function looksTechnical(message: string): boolean {
  return (
    message.length > 160 ||
    /\bat \S+:\d+:\d+\b/.test(message) ||
    /^[A-Z][a-zA-Z]*Error:/.test(message) ||
    /\.(ts|tsx|js|jsx):\d+/.test(message)
  );
}

export function toHumanMessage(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) return GENERIC_FALLBACK;
  const trimmed = raw.trim();
  const known = KNOWN_ERROR_PATTERNS.find((entry) => entry.match.test(trimmed));
  if (known) return known.message;
  if (looksTechnical(trimmed)) return GENERIC_FALLBACK;
  return trimmed;
}
