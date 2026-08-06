export function DeviceCard({
  icon,
  label,
  connected,
  detail,
}: {
  icon: string;
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div
      className={`fade-in flex items-center gap-3 rounded-xl border p-4 transition-colors ${
        connected ? "border-emerald-900/60 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950/60"
      }`}
    >
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        <p className={`text-xs ${connected ? "text-emerald-400" : "text-zinc-500"}`}>
          {connected ? (detail ?? "Conectado") : "No conectado"}
        </p>
      </div>
    </div>
  );
}
