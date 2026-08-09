"use client";

import { Cpu, Server } from "lucide-react";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { Card } from "@/components/ui/Card";
import { StatusDot } from "@/components/ui/StatusDot";

/**
 * Lista real de Edge Agents/dispositivos ya vinculados — antes /dispositivos
 * solo tenía el formulario de pairing, sin mostrar nunca lo que ya estaba
 * conectado, pese a que /api/status ya lo expone completo (mismo dato que
 * ya usa el Dashboard). Client component porque consume `SystemStatusProvider`
 * (mismo Context que TopBar/DashboardClient, un solo polling compartido).
 */
export function DeviceList() {
  const { status, loading } = useSystemStatusContext();

  if (loading && !status) {
    return <p className="text-sm text-ink-faint">Buscando dispositivos vinculados…</p>;
  }

  const agents = status?.edgeAgents ?? [];

  if (agents.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        Todavía no vinculaste ningún Edge Agent — generá un código más abajo y pegalo en la app de escritorio de KAN.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {agents.map((agent) => (
        <Card key={agent.id} padding="sm" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-ink-faint" aria-hidden="true" />
              <span className="text-sm font-medium text-ink">Edge Agent {agent.id.slice(0, 8)}</span>
              {agent.os && <span className="text-xs text-ink-faint">({agent.os})</span>}
            </div>
            <StatusDot
              level={agent.status === "online" ? "online" : "offline"}
              label={
                agent.status === "online" ? "Conectado" : `Desconectado — visto ${formatRelativeTime(agent.lastSeenAt)}`
              }
            />
          </div>

          {agent.devices.length === 0 ? (
            <p className="text-xs text-ink-faint">Sin dispositivos descubiertos todavía.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {agent.devices.map((device) => (
                <li key={device.id} className="flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-1.5 text-sm">
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="text-ink">{device.name}</span>
                  <span className="text-xs text-ink-faint">({device.kind})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
