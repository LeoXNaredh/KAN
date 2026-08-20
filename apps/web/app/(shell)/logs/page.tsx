import { Activity } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportLogsButton } from "@/components/logs/ExportLogsButton";
import { fetchAuditLog } from "@/lib/status/fetchAuditLog";
import { ACTOR_LABEL, translateAuditEntry } from "@/lib/status/translateAuditEntry";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { getCurrentUserTokenCached } from "@/lib/auth/getCurrentUserTokenCached";

export default async function LogsPage() {
  const token = await getCurrentUserTokenCached();
  const entries = await fetchAuditLog(token);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Logs</h1>
          <p className="text-sm text-ink-faint">Historial de actividad y auditoría de KAN (docs/12 §9).</p>
        </div>
        {entries && entries.length > 0 && <ExportLogsButton entries={entries} />}
      </div>

      <Card className="fade-in">
        {entries === undefined ? (
          <p className="text-sm text-ink-faint">
            No se pudo conectar con KAN — el historial no está disponible en este momento.
          </p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Sin actividad todavía"
            description="Acá vas a ver el historial de lo que KAN hizo y por qué."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {entries
              .slice()
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((entry, index) => (
                <Reveal
                  key={entry.id}
                  as="li"
                  delay={Math.min(index, 12) * 30}
                  className="flex flex-col gap-1 rounded-xl bg-surface-3/70 px-3 py-2 text-sm transition-all duration-fast hover:translate-x-0.5 hover:bg-surface-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0">
                    <span className="mr-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-accent uppercase">
                      {ACTOR_LABEL[entry.actor] ?? entry.actor}
                    </span>
                    <span className="text-ink">{translateAuditEntry(entry)}</span>
                  </div>
                  <span className="shrink-0 text-xs text-ink-faint">{formatRelativeTime(entry.at)}</span>
                </Reveal>
              ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
