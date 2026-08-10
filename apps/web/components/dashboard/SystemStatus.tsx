import { Card } from "@/components/ui/Card";
import type { SystemStatusResponse } from "@/lib/status/types";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";

export function SystemStatus({ status }: { status: SystemStatusResponse | null }) {
  const totalDevices = status?.edgeAgents.reduce((sum, agent) => sum + agent.devices.length, 0) ?? 0;
  const lastSeen = status?.edgeAgents[0]?.lastSeenAt;

  const rows: Array<[string, string]> = [
    ["Dispositivos conectados", status ? String(totalDevices) : "—"],
    ["Cosas que KAN puede hacer", status ? String(status.capabilitiesCount) : "—"],
    ["Última actividad", formatRelativeTime(lastSeen)],
  ];

  return (
    <Card className="fade-in">
      <h2 className="mb-3 text-sm font-medium text-ink-muted">En números</h2>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2 rounded-lg bg-surface-3 px-3 py-2">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
