export type StatusLevel = "online" | "warning" | "offline";

const LEVEL_STYLES: Record<StatusLevel, { dot: string; label: string; glow: string }> = {
  online: { dot: "bg-success", label: "text-success", glow: "var(--color-success)" },
  warning: { dot: "bg-warning", label: "text-warning", glow: "var(--color-warning)" },
  offline: { dot: "bg-danger", label: "text-danger", glow: "var(--color-danger)" },
};

/**
 * Nunca solo color: el texto siempre acompaña al punto de estado, para no
 * depender exclusivamente de la percepción de color (accesibilidad). El
 * pulso de "online" es puramente decorativo (aria-hidden) — refuerza "esto
 * está vivo ahora mismo" sin depender de él para transmitir el estado.
 */
export function StatusDot({ level, label }: { level: StatusLevel; label: string }) {
  const styles = LEVEL_STYLES[level];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        {level === "online" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${styles.dot}`}
          style={{ boxShadow: `0 0 8px 0 ${styles.glow}` }}
        />
      </span>
      <span className={`text-xs font-medium ${styles.label}`}>{label}</span>
    </span>
  );
}
