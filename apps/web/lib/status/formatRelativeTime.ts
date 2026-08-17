const WEEKDAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * "hace 125 h" no es legible pasado un día — a partir de las 24h pasa a
 * "ayer" / "hace N días", y a partir de una semana a una fecha calendario
 * ("lun 11 ago") en vez de seguir contando horas/días sin límite. Métodos
 * UTC (no locales) para la fecha calendario, mismo criterio que
 * `deriveConversationTitle` — determinístico sin importar el huso horario
 * del proceso que llama a esto.
 */
export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return `hace ${Math.max(diffSec, 0)}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays} días`;
  return `${WEEKDAYS_ES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_ES[date.getUTCMonth()]}`;
}
