"use client";

import { Cpu, Server } from "lucide-react";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { Card } from "@/components/ui/Card";

/**
 * Lista real de equipos vinculados y lo que cada uno descubrió — antes
 * /dispositivos solo tenía el formulario de pairing, sin mostrar nunca lo
 * que ya estaba conectado, pese a que /api/status ya lo expone completo
 * (mismo dato que ya usa el Dashboard). Client component porque consume
 * `SystemStatusProvider` (mismo Context que TopBar/DashboardClient, un solo
 * polling compartido).
 *
 * Rediseño (roadmap Línea B #5, "Mi entorno"): agrupar por ubicación o
 * proyecto quedó descartado a propósito — ni `EdgeAgentStatus` ni
 * `DeviceDescriptor` tienen ese dato hoy (`lib/status/types.ts`), y
 * agregarlo sería inventar un campo en vez de mostrar lo que existe.
 * Agrupar por equipo (que sí es un dato real) más un punto de estado con
 * pulso en vivo es la mejora real disponible sin tocar el Gateway.
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
        Todavía no vinculaste ningún equipo — generá un código más abajo y pegalo en la app de escritorio de KAN.
      </p>
    );
  }

  const totalDevices = agents.reduce((sum, agent) => sum + agent.devices.length, 0);
  const onlineAgents = agents.filter((agent) => agent.status === "online").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-faint">
        {totalDevices === 0
          ? `${onlineAgents} de ${agents.length} equipo(s) conectado(s), sin dispositivos descubiertos todavía.`
          : `${totalDevices} dispositivo(s) en ${agents.length} equipo(s) — ${onlineAgents} conectado(s) ahora.`}
      </p>

      {agents.map((agent, index) => (
        <Card key={agent.id} padding="sm" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-ink-faint" aria-hidden="true" />
              <span className="text-sm font-medium text-ink">
                {agent.os ? `Tu equipo (${agent.os})` : `Estación ${index + 1}`}
              </span>
            </div>
            <LiveIndicator
              online={agent.status === "online"}
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
                <li
                  key={device.id}
                  className="flex items-center gap-2 rounded-lg bg-surface-3/70 px-3 py-1.5 text-sm transition-colors hover:bg-surface-3"
                >
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="text-ink">{device.name}</span>
                  {agent.status === "online" && <LiveIndicator online label="" compact />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

/**
 * Punto de estado con pulso en vivo cuando está online (rediseño: "estado
 * en tiempo real más visual") — el `StatusDot` genérico de `components/ui`
 * es estático a propósito (se usa también para estados que no tiene
 * sentido animar, ej. severidad); acá el pulso comunica "esto se está
 * actualizando solo ahora mismo", que es justo el caso.
 */
function LiveIndicator({ online, label, compact = false }: { online: boolean; label: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${compact ? "ml-auto" : ""}`}>
      <span className="relative flex h-2 w-2 shrink-0">
        {online && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${online ? "bg-success" : "bg-danger"}`} />
      </span>
      {label && <span className={`text-xs font-medium ${online ? "text-success" : "text-danger"}`}>{label}</span>}
    </span>
  );
}
