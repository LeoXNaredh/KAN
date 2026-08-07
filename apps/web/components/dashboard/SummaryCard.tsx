import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function SummaryCard({
  icon: Icon,
  title,
  value,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <Card interactive className="fade-in flex items-start gap-3">
      <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        <p className="text-lg font-semibold text-ink">{value}</p>
        <p className="text-xs text-ink-faint">{hint}</p>
      </div>
    </Card>
  );
}
