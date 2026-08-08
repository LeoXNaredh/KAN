import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSession } from "../../lib/auth/SessionProvider";
import { useSystemStatus } from "../../lib/status/useSystemStatus";
import { formatRelativeTime } from "../../lib/status/formatRelativeTime";
import { StatusDot, type StatusLevel } from "../../components/StatusDot";
import type { ActivityEntry, SystemStatusResponse } from "../../lib/status/types";

/**
 * Dashboard (docs/18, incremento 6) — mismo `/api/status` que ya usa
 * `apps/web`'s DashboardClient, sin ningún cambio de backend. Muestra el
 * mismo contenido informativo (estado del Gateway/Edge Agent/IA,
 * capacidades, dispositivos, plugins, actividad reciente) en una única
 * columna nativa en vez del grid de tarjetas de escritorio — mismo
 * criterio ya aplicado en la pantalla de chat: paridad de información y
 * contrato, no paridad pixel-a-pixel de un layout pensado para desktop.
 * Deliberadamente sin la grilla de `DEVICE_CATALOG` (iconos por tipo de
 * dispositivo) de web — es una capa cosmética sobre los mismos
 * `edgeAgents[].devices`, ya visibles acá en la sección de dispositivos.
 */
export default function DashboardScreen() {
  const { session } = useSession();
  const { status, loading } = useSystemStatus();

  const levels = computeLevels(status);
  const totalDevices = status?.edgeAgents.reduce((sum, agent) => sum + agent.devices.length, 0) ?? 0;
  const totalPlugins = status?.edgeAgents.reduce((sum, agent) => sum + agent.installedPlugins.length, 0) ?? 0;
  const allPlugins = status?.edgeAgents.flatMap((agent) => agent.installedPlugins) ?? [];

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <View>
        <Text className="text-lg font-semibold text-ink">Dashboard</Text>
        <Text className="text-sm text-ink-faint">{session?.email}</Text>
      </View>

      {loading && !status && <Text className="text-sm text-ink-faint">Cargando estado…</Text>}

      {status && (
        <>
          <Section title="Estado del sistema">
            <StatusDot level={levels.gateway} label={`Gateway: ${status.gateway === "online" ? "conectado" : "desconectado"}`} />
            <StatusDot level={levels.edgeAgent} label={`Edge Agent: ${levels.edgeAgent === "online" ? "conectado" : "desconectado"}`} />
            <StatusDot level={levels.ai} label={`IA: ${status.ai === "configured" ? "configurada" : "sin configurar"}`} />
            <StatusDot level={levels.overall} label={`Estado general: ${LEVEL_LABEL[levels.overall]}`} />
          </Section>

          <Section title="Resumen">
            <SummaryRow label="Capacidades detectadas" value={String(status.capabilitiesCount)} />
            <SummaryRow label="Dispositivos activos" value={String(totalDevices)} />
            <SummaryRow label="Plugins cargados" value={String(totalPlugins)} />
            <SummaryRow label="Última sincronización" value={formatRelativeTime(status.edgeAgents[0]?.lastSeenAt)} />
            <SummaryRow label="Versión" value={status.version} />
          </Section>

          <Section title="Plugins activos">
            {allPlugins.length === 0 ? (
              <Text className="text-sm text-ink-faint">Ningún plugin activo.</Text>
            ) : (
              allPlugins.map((plugin) => (
                <View key={plugin.id} className="flex-row items-center justify-between">
                  <Text className="text-sm text-ink">{plugin.displayName}</Text>
                  <Text className="font-mono text-xs text-ink-faint">{plugin.id}</Text>
                </View>
              ))
            )}
          </Section>

          <Section title="Actividad reciente">
            {status.recentActivity.length === 0 ? (
              <Text className="text-sm text-ink-faint">Sin actividad todavía.</Text>
            ) : (
              status.recentActivity.map((entry: ActivityEntry) => (
                <View key={entry.id} className="flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-sm text-ink">{entry.label}</Text>
                  <Text className="text-xs text-ink-faint">{formatRelativeTime(entry.at)}</Text>
                </View>
              ))
            )}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function computeLevels(status: SystemStatusResponse | null) {
  const gateway: StatusLevel = status?.gateway === "online" ? "online" : "offline";
  const anyAgentOnline = status?.edgeAgents.some((agent) => agent.status === "online") ?? false;
  const edgeAgent: StatusLevel = !status ? "offline" : anyAgentOnline ? "online" : "warning";
  const ai: StatusLevel = status?.ai === "configured" ? "online" : "warning";
  const overall: StatusLevel = gateway === "offline" ? "offline" : edgeAgent === "online" && ai === "online" ? "online" : "warning";
  return { gateway, edgeAgent, ai, overall };
}

const LEVEL_LABEL: Record<StatusLevel, string> = { online: "operativo", warning: "atención", offline: "caído" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <Text className="text-sm font-medium text-ink-muted">{title}</Text>
      {children}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-ink-muted">{label}</Text>
      <Text className="text-sm text-ink">{value}</Text>
    </View>
  );
}
