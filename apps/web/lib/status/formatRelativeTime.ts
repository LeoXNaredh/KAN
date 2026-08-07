export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `hace ${Math.max(diffSec, 0)}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  return `hace ${Math.round(diffMin / 60)} h`;
}
