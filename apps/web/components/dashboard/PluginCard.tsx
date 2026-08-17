import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";

export function PluginCard({ plugins }: { plugins: Array<{ id: string; displayName: string }> }) {
  return (
    <Card className="fade-in">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
        Lo que KAN puede hacer ahora
      </h2>
      {plugins.length === 0 ? (
        <p className="text-sm text-ink-faint">Todavía nada — conectá un dispositivo para desbloquear capacidades.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plugins.map((plugin, index) => (
            <Reveal
              key={plugin.id}
              as="li"
              delay={index * 40}
              className="rounded-xl bg-surface-3/70 px-3 py-2 text-sm text-ink transition-all duration-fast hover:translate-x-0.5 hover:bg-surface-3"
            >
              {plugin.displayName}
            </Reveal>
          ))}
        </ul>
      )}
    </Card>
  );
}
