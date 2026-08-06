export type StatusLevel = "online" | "warning" | "offline";

const LEVEL_STYLES: Record<StatusLevel, { dot: string; label: string }> = {
  online: { dot: "bg-success", label: "text-success" },
  warning: { dot: "bg-warning", label: "text-warning" },
  offline: { dot: "bg-danger", label: "text-danger" },
};

/**
 * Nunca solo color: el texto siempre acompaña al punto de estado, para no
 * depender exclusivamente de la percepción de color (accesibilidad).
 */
export function StatusDot({ level, label }: { level: StatusLevel; label: string }) {
  const styles = LEVEL_STYLES[level];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${styles.dot}`} aria-hidden="true" />
      <span className={`text-xs font-medium ${styles.label}`}>{label}</span>
    </span>
  );
}
