/**
 * Saludo según hora del día para el Dashboard (rediseño de interfaz) — se
 * calcula client-side después de montar (ver `DashboardClient`), nunca
 * directo en el primer render: la hora del servidor (Vercel, UTC) y la del
 * navegador del usuario difieren, así que evaluarlo durante SSR produciría
 * un saludo distinto al que corrige React al hidratar (mismatch warning).
 */
export function timeOfDayGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return "Buenas noches";
  if (hour < 12) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** El displayName es opcional (UserProfile.displayName?) — sin uno configurado, un "Hola" seco es más natural que inventar un nombre genérico. */
export function buildGreeting(timeGreeting: string, displayName: string | undefined): string {
  return displayName ? `${timeGreeting}, ${displayName}.` : "Hola.";
}
