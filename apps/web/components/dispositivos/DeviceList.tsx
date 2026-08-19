"use client";

import { Cpu, Server, Search } from "lucide-react";
import { useState } from "react";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDeviceDisplayNames } from "@/lib/devices/useDeviceDisplayNames";

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
  const displayName = useDeviceDisplayNames();
  const [searchQuery, setSearchQuery] = useState("");

  if (loading && !status) {
    return (
      <div className="flex flex-col gap-3" aria-label="Buscando dispositivos vinculados…">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  const agents = status?.edgeAgents ?? [];

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Cpu}
        title="Ningún dispositivo conectado"
        description="Todavía no vinculaste ningún equipo — generá un código más abajo y pegalo en la app de escritorio de KAN."
      />
    );
  }

  const totalDevices = agents.reduce((sum, agent) => sum + agent.devices.length, 0);
  const onlineAgents = agents.filter((agent) => agent.status === "online").length;

  const filteredAgents = agents.filter((agent) => {
    const term = searchQuery.toLowerCase();
    const matchesAgent = (agent.os || "").toLowerCase().includes(term);
    const matchesDevices = agent.devices.some(device => 
      displayName(device.name).toLowerCase().includes(term) || device.name.toLowerCase().includes(term)
    );
    return matchesAgent || matchesDevices;
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-faint">
        {totalDevices === 0
          ? `${onlineAgents} de ${agents.length} equipo(s) conectado(s), sin dispositivos descubiertos todavía.`
          : `${totalDevices} dispositivo(s) en ${agents.length} equipo(s) — ${onlineAgents} conectado(s) ahora.`}
      </p>

      <div className="relative mb-2">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden="true" />
        </div>
        <input
          type="search"
          placeholder="Buscar por equipo o dispositivo..."
          className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-9 pr-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent transition-colors duration-fast"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {filteredAgents.length === 0 && searchQuery && (
        <p className="text-sm text-ink-faint py-4 text-center">No se encontraron equipos o dispositivos que coincidan con la búsqueda.</p>
      )}

      {filteredAgents.map((agent, index) => (
        <Reveal key={agent.id} delay={index * 60}>
          <Card padding="sm" className="flex flex-col gap-3">
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
                    className="flex items-center gap-2 rounded-lg bg-surface-3/70 px-3 py-1.5 text-sm transition-all duration-fast hover:translate-x-0.5 hover:bg-surface-3"
                  >
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span className="text-ink" title={device.name}>
                      {displayName(device.name)}
                    </span>
                    {agent.status === "online" && <LiveIndicator online label="" compact />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Reveal>
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
