import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface-2/60 px-6 py-20 text-center">
      <Sparkles className="h-6 w-6 text-accent" aria-hidden="true" />
      <Badge>Próximamente</Badge>
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="max-w-md text-sm text-ink-muted">{description}</p>
    </div>
  );
}
