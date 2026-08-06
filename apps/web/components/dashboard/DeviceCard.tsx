import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function DeviceCard({
  icon: Icon,
  label,
  connected,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <Card
      padding="sm"
      className={`fade-in flex items-center gap-3 ${connected ? "border-success/40 bg-success/5" : ""}`}
    >
      <Icon className={`h-6 w-6 shrink-0 ${connected ? "text-success" : "text-ink-faint"}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className={`text-xs ${connected ? "text-success" : "text-ink-faint"}`}>
          {connected ? (detail ?? "Conectado") : "No conectado"}
        </p>
      </div>
    </Card>
  );
}
