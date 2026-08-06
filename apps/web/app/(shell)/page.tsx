"use client";

import { Cpu, CircuitBoard, Bot, Printer, Zap, FlaskConical, type LucideIcon } from "lucide-react";
import { useSystemStatus } from "@/lib/status/useSystemStatus";
import { StatusCard } from "@/components/dashboard/StatusCard";
import { DeviceCard } from "@/components/dashboard/DeviceCard";
import { SystemStatus } from "@/components/dashboard/SystemStatus";
import { PluginCard } from "@/components/dashboard/PluginCard";
import { VoiceButton } from "@/components/dashboard/VoiceButton";
import { ConversationPanel } from "@/components/dashboard/ConversationPanel";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import type { StatusLevel } from "@/components/ui/StatusDot";

const DEVICE_CATALOG: Array<{ key: string; label: string; icon: LucideIcon; matches: (kind: string) => boolean }> = [
  { key: "esp32", label: "ESP32", icon: Cpu, matches: (kind) => kind === "esp32-arduino" },
  { key: "arduino", label: "Arduino", icon: CircuitBoard, matches: (kind) => kind === "esp32-arduino" },
  { key: "robot", label: "Robot", icon: Bot, matches: (kind) => kind.includes("robot") },
  { key: "printer", label: "Impresora 3D", icon: Printer, matches: (kind) => kind.includes("print") },
  { key: "laser", label: "CNC / Láser", icon: Zap, matches: (kind) => kind.includes("cnc") || kind.includes("laser") },
  { key: "simulator", label: "Simulador", icon: FlaskConical, matches: (kind) => kind === "device-simulator" },
];

export default function DashboardPage() {
  const { status } = useSystemStatus();

  const allDevices = status?.edgeAgents.flatMap((agent) => agent.devices) ?? [];
  const allPlugins = status?.edgeAgents.flatMap((agent) => agent.installedPlugins) ?? [];
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Dashboard</h1>
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
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Dispositivos</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {DEVICE_CATALOG.map((entry) => {
            const connected = allDevices.some((device) => entry.matches(device.kind));
            return <DeviceCard key={entry.key} icon={entry.icon} label={entry.label} connected={connected} />;
          })}
        </div>
      </section>

      <DashboardGrid>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ConversationPanel compact />
        </div>
        <div className="flex flex-col gap-4">
          <VoiceButton />
          <SystemStatus status={status} />
          <PluginCard plugins={allPlugins} />
        </div>
      </DashboardGrid>
    </div>
  );
}
