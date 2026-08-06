import { Puzzle } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function PluginCard({ plugins }: { plugins: Array<{ id: string; displayName: string }> }) {
  return (
    <Card className="fade-in">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Puzzle className="h-4 w-4" aria-hidden="true" />
        Plugins activos
      </h2>
      {plugins.length === 0 ? (
        <p className="text-sm text-ink-faint">Ningún plugin activo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plugins.map((plugin) => (
            <li key={plugin.id} className="flex items-center justify-between rounded-lg bg-surface-3 px-3 py-2 text-sm">
              <span className="text-ink">{plugin.displayName}</span>
              <span className="text-xs text-ink-faint">{plugin.id}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
