"use client";

import type { ReactNode } from "react";
import { Activity, Brain, Cpu, FolderKanban, Radio, Sparkles } from "lucide-react";
import type { DashboardSummary } from "@kan/core";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { useDeviceDisplayNames } from "@/lib/devices/useDeviceDisplayNames";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { useClock } from "@/lib/useClock";

/**
 * Panel de información (rediseño inspirado en Gemini) — estado del sistema,
 * dispositivos, memoria/proyectos, plugins y actividad reciente. Colapsado
 * por defecto: `ShellChrome` lo monta como panel lateral bajo demanda (ícono
 * en el TopBar), no como una columna siempre visible — reusa
 * `useSystemStatusContext` (ya global, un solo poll de 15s compartido con
 * TopBar/DashboardClient) en vez de pedir sus propios datos por separado.
 *
 * No hay un campo real de CPU/RAM del Edge Agent en `SystemStatusResponse`
 * hoy (`lib/status/types.ts`) — se muestra lo que el backend efectivamente
 * expone (online/offline, capabilities, dispositivos) en vez de inventar
 * una métrica que no existe.
 */
export function InfoPanel({ summary }: { summary: DashboardSummary | undefined }) {
  const { status } = useSystemStatusContext();
  const resolveDeviceName = useDeviceDisplayNames();
  const now = useClock();

  const allDevices = (status?.edgeAgents ?? []).flatMap((agent) =>
    agent.devices.map((device) => ({ ...device, agentOnline: agent.status === "online" })),
  );
  // Mismo de-dupe por id que antes vivía en DashboardClient (dos Edge Agents
  // pueden compartir un plugin instalado, ej. desktop + Simulador embebido).
  const allPlugins = Array.from(
    new Map((status?.edgeAgents.flatMap((agent) => agent.installedPlugins) ?? []).map((p) => [p.id, p])).values(),
  );

  return (
    <aside aria-label="Panel de información" className="kan-scroll flex flex-1 flex-col gap-5 overflow-y-auto bg-surface-2 p-4 text-sm">
      <div>
        <p className="text-xs text-ink-faint">Hora del sistema</p>
        <p className="mt-1 text-xl font-medium text-ink tabular-nums">
          {now ? now.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
        </p>
        <p className="text-xs text-ink-muted">
          {now ? now.toLocaleDateString("es", { weekday: "long", day: "2-digit", month: "short" }) : ""}
        </p>
      </div>

      <InfoSection icon={Radio} title="Estado del sistema">
        <InfoRow label="Gateway" value={status?.gateway === "online" ? "En línea" : "Fuera de línea"} ok={status?.gateway === "online"} />
        <InfoRow label="IA" value={status?.ai === "configured" ? "Configurada" : "Sin configurar"} ok={status?.ai === "configured"} />
        <InfoRow label="Capacidades" value={status ? String(status.capabilitiesCount) : "—"} />
        <InfoRow label="Recordatorios" value={status ? String(status.jobsCount) : "—"} />
      </InfoSection>

      <InfoSection icon={Cpu} title={`Dispositivos (${allDevices.length})`}>
        {allDevices.length === 0 ? (
          <p className="text-xs text-ink-faint">Ninguno conectado.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allDevices.map((device) => (
              <li key={device.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${device.agentOnline ? "bg-success" : "bg-ink-faint"}`}
                  aria-hidden="true"
                />
                <span className="truncate text-xs text-ink-muted">{resolveDeviceName(device.name)}</span>
              </li>
            ))}
          </ul>
        )}
      </InfoSection>

      <InfoSection icon={Brain} title="Memoria">
        <InfoRow label="Recuerdos" value={summary ? String(summary.memoriesCount) : "—"} />
        <InfoRow label="Proyectos" value={summary ? String(summary.projectsCount) : "—"} icon={FolderKanban} />
      </InfoSection>

      <InfoSection icon={Sparkles} title={`Plugins (${allPlugins.length})`}>
        {allPlugins.length === 0 ? (
          <p className="text-xs text-ink-faint">Ninguno todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allPlugins.map((plugin) => (
              <li key={plugin.id} className="truncate text-xs text-ink-muted">
                {plugin.displayName}
              </li>
            ))}
          </ul>
        )}
      </InfoSection>

      <InfoSection icon={Activity} title="Actividad reciente">
        {!status || status.recentActivity.length === 0 ? (
          <p className="text-xs text-ink-faint">Sin actividad todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {status.recentActivity.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-ink-muted">{entry.label}</span>
                <span className="shrink-0 text-[10px] text-ink-faint">{formatRelativeTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </InfoSection>
    </aside>
  );
}

function InfoSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Activity;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value, ok, icon: Icon }: { label: string; value: string; ok?: boolean; icon?: typeof FolderKanban }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-ink-faint">
        {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {label}
      </span>
      <span className={ok === undefined ? "text-ink" : ok ? "text-success" : "text-danger"}>{value}</span>
    </div>
  );
}
