import type { SystemStatusResponse } from "@/lib/status/types";

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `hace ${Math.max(diffSec, 0)}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  return `hace ${Math.round(diffMin / 60)} h`;
}

export function SystemStatus({ status }: { status: SystemStatusResponse | null }) {
  const totalDevices = status?.edgeAgents.reduce((sum, agent) => sum + agent.devices.length, 0) ?? 0;
  const totalPlugins = status?.edgeAgents.reduce((sum, agent) => sum + agent.installedPlugins.length, 0) ?? 0;
  const lastSeen = status?.edgeAgents[0]?.lastSeenAt;
  const anyAgentOnline = status?.edgeAgents.some((agent) => agent.status === "online") ?? false;

  const rows: Array<[string, string]> = [
    ["Gateway", status?.gateway === "online" ? "Conectado" : "Desconectado"],
    ["Edge Agent", anyAgentOnline ? "Conectado" : "Desconectado"],
    ["Plugin Manager", status ? `${totalPlugins} plugin(s) cargado(s)` : "—"],
    ["Capacidades detectadas", status ? String(status.capabilitiesCount) : "—"],
    ["Dispositivos activos", status ? String(totalDevices) : "—"],
    ["Última sincronización", formatRelativeTime(lastSeen)],
    ["Versión", status?.version ?? "—"],
  ];

  return (
    <div className="fade-in rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-300">Estado del sistema</h2>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900/60 px-3 py-2">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="font-medium text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
