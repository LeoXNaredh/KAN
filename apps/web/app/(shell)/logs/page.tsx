import { Activity } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExportLogsButton } from "@/components/logs/ExportLogsButton";
import { LogsExplorer } from "@/components/logs/LogsExplorer";
import { fetchAuditLog } from "@/lib/status/fetchAuditLog";
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

      {entries === undefined ? (
        <Card className="fade-in">
          <p className="text-sm text-ink-faint">
            No se pudo conectar con KAN — el historial no está disponible en este momento.
          </p>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="fade-in">
          <EmptyState
            icon={Activity}
            title="Sin actividad todavía"
            description="Acá vas a ver el historial de lo que KAN hizo y por qué."
          />
        </Card>
      ) : (
        <LogsExplorer entries={entries} />
      )}
    </div>
  );
}
