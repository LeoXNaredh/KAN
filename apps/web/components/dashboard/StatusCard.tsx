import { Card } from "@/components/ui/Card";
import { StatusDot, type StatusLevel } from "@/components/ui/StatusDot";

export function StatusCard({
  title,
  level,
  label,
  detail,
}: {
  title: string;
  level: StatusLevel;
  label: string;
  detail?: string;
}) {
  return (
    <Card interactive className="fade-in">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        <StatusDot level={level} label={label} />
      </div>
      {detail && <p className="mt-1 text-xs text-ink-faint">{detail}</p>}
    </Card>
  );
}
