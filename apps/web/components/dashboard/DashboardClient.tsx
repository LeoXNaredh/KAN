"use client";

import { Cpu, Brain, FolderKanban, Workflow } from "lucide-react";
import type { DashboardSummary } from "@kan/core";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { StatusCard } from "@/components/dashboard/StatusCard";
import { DeviceCard } from "@/components/dashboard/DeviceCard";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { SystemStatus } from "@/components/dashboard/SystemStatus";
import { PluginCard } from "@/components/dashboard/PluginCard";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ConversationPanel } from "@/components/dashboard/ConversationPanel";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { Card } from "@/components/ui/Card";
import type { StatusLevel } from "@/components/ui/StatusDot";

export function DashboardClient({ summary }: { summary: DashboardSummary | undefined }) {
  const { status } = useSystemStatusContext();

  // Antes: un catálogo fijo de 6 íconos (ESP32/Arduino/Robot/Impresora/CNC/
  // Simulador) "encendidos" por un matcher de substring sobre `kind` — con
  // el bug de que ESP32 y Arduino compartían el mismo matcher, así que un
  // solo dispositivo encendía las dos tarjetas. Ahora: los dispositivos
  // reales que cada Edge Agent ya reportó, con su nombre real — sin inventar
  // categorías que no existen en los 15 plugins reales.
  const allDevices = (status?.edgeAgents ?? []).flatMap((agent) =>
    agent.devices.map((device) => ({ ...device, agentOnline: agent.status === "online" })),
  );
  // Dos Edge Agents (ej. desktop + Simulador embebido en el navegador,
  // docs/12) pueden tener el mismo plugin instalado — de-dupe por id para no
  // listarlo dos veces (y no repetir key de React).
  const allPlugins = Array.from(
    new Map((status?.edgeAgents.flatMap((agent) => agent.installedPlugins) ?? []).map((p) => [p.id, p])).values(),
  );
  const anyAgentOnline = status?.edgeAgents.some((agent) => agent.status === "online") ?? false;

  const coreLevel: StatusLevel = "online";
  const gatewayLevel: StatusLevel = status?.gateway === "online" ? "online" : "offline";
  const edgeAgentLevel: StatusLevel = !status ? "offline" : anyAgentOnline ? "online" : "warning";
  const aiLevel: StatusLevel = status?.ai === "configured" ? "online" : "warning";
  const overallLevel: StatusLevel =
    gatewayLevel === "offline"
      ? "offline"
      : edgeAgentLevel === "online" && aiLevel === "online"
        ? "online"
        : "warning";

  const displayName = summary?.profile.displayName;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">{displayName ? `Hola, ${displayName}` : "Dashboard"}</h1>
        <p className="text-sm text-ink-faint">Resumen general de KAN.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatusCard title="Core" level={coreLevel} label="Activo" />
        <StatusCard
          title="Gateway"
          level={gatewayLevel}
          label={gatewayLevel === "online" ? "Conectado" : "Desconectado"}
        />
        <StatusCard
          title="Edge Agent"
          level={edgeAgentLevel}
          label={edgeAgentLevel === "online" ? "Conectado" : edgeAgentLevel === "warning" ? "Sin agentes" : "Desconectado"}
        />
        <StatusCard title="IA" level={aiLevel} label={aiLevel === "online" ? "Configurada" : "Sin configurar"} />
        <StatusCard
          title="Estado General"
          level={overallLevel}
          label={overallLevel === "online" ? "Todo bien" : overallLevel === "warning" ? "Atención" : "Desconectado"}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Tu espacio</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={Brain}
            title="Memoria"
            value={summary ? String(summary.memoriesCount) : "—"}
            hint={summary && summary.memoriesCount === 0 ? "Vacía — KAN empezará a recordar según la uses" : "Recuerdos guardados"}
          />
          <SummaryCard
            icon={FolderKanban}
            title="Proyectos"
            value={summary ? String(summary.projectsCount) : "—"}
            hint={summary && summary.projectsCount === 0 ? "Sin proyectos todavía" : "Proyectos activos"}
          />
          <SummaryCard
            icon={Workflow}
            title="Automatizaciones"
            value={status ? String(status.jobsCount) : "—"}
            hint={status && status.jobsCount === 0 ? "Sin automatizaciones programadas" : "Jobs activos"}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Dispositivos</h2>
        {allDevices.length === 0 ? (
          <Card padding="sm" className="fade-in">
            <p className="text-sm text-ink-faint">
              Ningún dispositivo descubierto todavía — vinculá un Edge Agent desde Dispositivos.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {allDevices.map((device) => (
              <DeviceCard key={device.id} icon={Cpu} label={device.name} connected={device.agentOnline} detail={device.kind} />
            ))}
          </div>
        )}
      </section>

      <DashboardGrid>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ConversationPanel compact />
        </div>
        <div className="flex flex-col gap-4">
          <SystemStatus status={status} />
          <ActivityFeed activity={status?.recentActivity ?? []} />
          <PluginCard plugins={allPlugins} />
        </div>
      </DashboardGrid>
    </div>
  );
}
