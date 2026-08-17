/**
 * Clases de Tailwind compartidas para formularios (auth, CRUDs de
 * /configuracion, /proyectos, /automatizaciones) — constantes literales
 * (no interpoladas) para que Tailwind pueda seguir descubriéndolas en
 * build time, evitando repetir la misma cadena larga en cada input/botón
 * (mismo principio "sin duplicación" del Design System).
 */
export const INPUT_CLASSES =
  "rounded-xl border border-line/80 bg-surface-3/70 px-3 py-2 text-sm text-ink outline-none backdrop-blur transition-colors placeholder:text-ink-faint focus:border-accent/70 focus:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export const PRIMARY_BUTTON_CLASSES =
  "bg-gradient-accent rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-all duration-fast hover:scale-[1.02] hover:shadow-accent/40 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const SECONDARY_BUTTON_CLASSES =
  "glass rounded-xl border border-line/80 px-4 py-2 text-sm font-medium text-ink-muted transition-all duration-fast hover:border-accent/40 hover:text-ink active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
