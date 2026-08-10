import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function PluginCard({ plugins }: { plugins: Array<{ id: string; displayName: string }> }) {
  return (
    <Card className="fade-in">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Lo que KAN puede hacer ahora
      </h2>
      {plugins.length === 0 ? (
        <p className="text-sm text-ink-faint">Todavía nada — conectá un dispositivo para desbloquear capacidades.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plugins.map((plugin) => (
            <li key={plugin.id} className="rounded-lg bg-surface-3 px-3 py-2 text-sm text-ink">
              {plugin.displayName}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
