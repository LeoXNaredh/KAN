import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="glass fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-line/80 px-6 py-20 text-center">
      <div className="bg-gradient-accent-soft glow-accent-sm flex h-12 w-12 items-center justify-center rounded-2xl">
        <Sparkles className="h-6 w-6 text-accent" aria-hidden="true" />
      </div>
      <Badge>Próximamente</Badge>
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="max-w-md text-sm text-ink-muted">{description}</p>
    </div>
  );
}
