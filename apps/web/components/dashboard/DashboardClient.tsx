"use client";

import { Cpu, Brain, FolderKanban, Workflow } from "lucide-react";
import type { DashboardSummary } from "@kan/core";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { buildHeroStatus } from "@/lib/status/buildHeroStatus";
import { buildGreeting, timeOfDayGreeting } from "@/lib/greeting";
import { useIsClient } from "@/lib/useIsClient";
import { HeroStatus } from "@/components/dashboard/HeroStatus";
import { OnboardingWelcome } from "@/components/dashboard/OnboardingWelcome";
import { DeviceCard } from "@/components/dashboard/DeviceCard";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { SystemStatus } from "@/components/dashboard/SystemStatus";
import { PluginCard } from "@/components/dashboard/PluginCard";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ConversationPanel } from "@/components/dashboard/ConversationPanel";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { Card } from "@/components/ui/Card";

export function DashboardClient({ summary }: { summary: DashboardSummary | undefined }) {
  const { status, loading } = useSystemStatusContext();

  // Se calcula recién después de hidratar (useIsClient) — evita un mismatch
  // entre la hora del servidor (Vercel, UTC) y la del navegador del
  // usuario. "Hola." es el saludo neutro hasta entonces (ver lib/greeting.ts).
  const isClient = useIsClient();
  const greeting = isClient ? timeOfDayGreeting() : null;

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

  const heroStatus = buildHeroStatus(status);
  const displayName = summary?.profile.displayName;
  // Recién cuando /api/status ya resolvió al menos una vez (no loading) —
  // sin esto, todo usuario vería la bienvenida guiada un instante mientras
  // sus dispositivos reales todavía están cargando (allDevices.length
  // arranca en 0 para cualquiera, no solo para quien es nuevo de verdad).
  const isNewUser = Boolean(summary) && !loading && summary?.memoriesCount === 0 && allDevices.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="fade-in text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {buildGreeting(greeting ?? "Hola", displayName)}
        </h1>
        <div className="mt-3">
          <HeroStatus status={heroStatus} />
        </div>
      </div>

      {isNewUser && <OnboardingWelcome displayName={displayName} />}

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
            title="Recordatorios"
            value={status ? String(status.jobsCount) : "—"}
            hint={status && status.jobsCount === 0 ? "Sin nada programado" : "Programados"}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Tus dispositivos</h2>
        {allDevices.length === 0 ? (
          <Card padding="sm" className="fade-in">
            <p className="text-sm text-ink-faint">
              Ningún dispositivo conectado todavía — vinculá tu primer equipo desde Dispositivos.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {allDevices.map((device) => (
              <DeviceCard key={device.id} icon={Cpu} label={device.name} connected={device.agentOnline} />
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
