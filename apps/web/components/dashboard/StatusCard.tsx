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
    <div className="fade-in rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 transition-colors hover:border-zinc-700">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-300">{title}</p>
        <StatusDot level={level} label={label} />
      </div>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
    </div>
  );
}
