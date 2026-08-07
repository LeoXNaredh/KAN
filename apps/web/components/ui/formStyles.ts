/**
 * Clases de Tailwind compartidas para formularios de auth (login/signup) —
 * constantes literales (no interpoladas) para que Tailwind pueda seguir
 * descubriéndolas en build time, evitando repetir la misma cadena larga en
 * cada input/botón (mismo principio "sin duplicación" del Design System).
 */
export const INPUT_CLASSES =
  "rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink outline-none focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export const PRIMARY_BUTTON_CLASSES =
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:brightness-110 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export const SECONDARY_BUTTON_CLASSES =
  "rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
