"use client";

import type { ReactNode } from "react";
import { Activity, Brain, Cpu, FolderKanban, Radio, Sparkles } from "lucide-react";
import type { DashboardSummary } from "@kan/core";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { useDeviceDisplayNames } from "@/lib/devices/useDeviceDisplayNames";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { useClock } from "@/lib/useClock";

/**
 * Tercer panel del layout eDEX-UI (rediseño completo) — columna derecha
 * persistente con estado del sistema, dispositivos, memoria/proyectos y
 * actividad reciente. Vive en `ShellChrome` (no en `KANHome`/`DashboardClient`)
 * porque el pedido es un frame de 3 columnas para todo el shell, no solo
 * para la pantalla de chat — reusa `useSystemStatusContext` (ya global, un
 * solo poll de 15s compartido con TopBar/DashboardClient) en vez de pedir
 * sus propios datos por separado.
 *
 * No hay un campo real de CPU/RAM del Edge Agent en `SystemStatusResponse`
 * hoy (`lib/status/types.ts`) — se muestra lo que el backend efectivamente
 * expone (online/offline, capabilities, dispositivos) en vez de inventar
 * una métrica que no existe (mismo criterio que `ActivityFeed`/`SystemStatus`
 * ya seguían).
 *
 * `mobile`: por debajo de `lg` (1024px) no hay lugar para 3 columnas — ShellChrome
 * monta esta misma instancia (mismo componente, sin lógica duplicada) dentro
 * de un tab en vez de la columna fija; este prop solo cambia el wrapper
 * (ancho/posición), nunca el contenido.
 */
export function InfoPanel({ summary, mobile = false }: { summary: DashboardSummary | undefined; mobile?: boolean }) {
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
    <aside
      aria-label="Panel de información"
      className={
        mobile
          ? "hud-panel hud-brackets glass kan-scroll flex w-full flex-col gap-5 overflow-y-auto p-4 font-mono text-xs"
          : "hud-panel hud-brackets glass kan-scroll hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto p-4 font-mono text-xs lg:flex"
      }
    >
      <div>
        <p className="text-[10px] tracking-[0.2em] text-ink-faint uppercase">Hora del sistema</p>
        <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">
          {now ? now.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
        </p>
        <p className="text-ink-muted">
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
          <p className="text-ink-faint">Ninguno conectado.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allDevices.map((device) => (
              <li key={device.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${device.agentOnline ? "bg-success" : "bg-ink-faint"}`}
                  style={device.agentOnline ? { boxShadow: "0 0 6px 0 var(--color-success)" } : undefined}
                  aria-hidden="true"
                />
                <span className="truncate text-ink-muted">{resolveDeviceName(device.name)}</span>
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
          <p className="text-ink-faint">Ninguno todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allPlugins.map((plugin) => (
              <li key={plugin.id} className="truncate text-ink-muted">
                {plugin.displayName}
              </li>
            ))}
          </ul>
        )}
      </InfoSection>

      <InfoSection icon={Activity} title="Actividad reciente">
        {!status || status.recentActivity.length === 0 ? (
          <p className="text-ink-faint">Sin actividad todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {status.recentActivity.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-ink-muted">{entry.label}</span>
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
      <h2 className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-accent uppercase">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value, ok, icon: Icon }: { label: string; value: string; ok?: boolean; icon?: typeof FolderKanban }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-ink-faint">
        {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {label}
      </span>
      <span className={ok === undefined ? "text-ink" : ok ? "text-success" : "text-danger"}>{value}</span>
    </div>
  );
}
