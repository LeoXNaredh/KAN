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
    <Card interactive className="flex items-start gap-3">
      <div className="bg-gradient-accent-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
        <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        <p className="text-xl font-semibold text-ink">{value}</p>
        <p className="text-xs text-ink-faint">{hint}</p>
      </div>
    </Card>
  );
}
