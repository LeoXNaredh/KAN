import { Activity } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import type { ActivityEntry } from "@/lib/status/types";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";

/**
 * Widget de "actividad" del Dashboard inteligente (P4) — entradas reales del
 * Audit Service del Gateway (docs/12 §9), ya traducidas server-side en
 * app/api/status/route.ts. Vacío hasta que exista una tool ejecutada o un
 * cambio de política de seguridad real, nunca datos inventados.
 */
export function ActivityFeed({ activity }: { activity: ActivityEntry[] }) {
  return (
    <Card className="fade-in">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
        Actividad reciente
      </h2>
      {activity.length === 0 ? (
        <p className="text-sm text-ink-faint">Sin actividad todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {activity.map((entry, index) => (
            <Reveal
              key={entry.id}
              as="li"
              delay={index * 40}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface-3/70 px-3 py-2 text-sm transition-all duration-fast hover:translate-x-0.5 hover:bg-surface-3"
            >
              <span className="text-ink">{entry.label}</span>
              <span className="shrink-0 text-xs text-ink-faint">{formatRelativeTime(entry.at)}</span>
            </Reveal>
          ))}
        </ul>
      )}
    </Card>
  );
}
