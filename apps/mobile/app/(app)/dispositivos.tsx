import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSystemStatus } from "../../lib/status/useSystemStatus";
import { formatRelativeTime } from "../../lib/status/formatRelativeTime";
import { StatusDot } from "../../components/StatusDot";
import type { EdgeAgentStatus } from "../../lib/status/types";

/**
 * Dispositivos (versión mínima, solo lectura) — mismo `/api/status` que ya
 * consume DashboardScreen (useSystemStatus.ts), mismo dato que
 * DeviceList.tsx en apps/web (status.edgeAgents[].devices). Sin acción
 * (aparear, compartir acceso): esta pantalla solo lista lo que ya está
 * conectado, igual que pidió el diagnóstico previo.
 */
export default function DispositivosScreen() {
  const { status, loading } = useSystemStatus();
  const agents = status?.edgeAgents ?? [];

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <Text className="text-lg font-semibold text-ink">Dispositivos</Text>

      {loading && !status && (
        <View className="items-center py-8">
          <ActivityIndicator color="#0ea5e9" />
        </View>
      )}

      {!loading && agents.length === 0 && (
        <Text className="text-sm text-ink-faint">Ningún dispositivo conectado todavía.</Text>
      )}

      {agents.map((agent, index) => (
        <AgentCard key={agent.id} agent={agent} index={index} />
      ))}
    </ScrollView>
  );
}

function AgentCard({ agent, index }: { agent: EdgeAgentStatus; index: number }) {
  return (
    <View className="gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-ink-muted">
          {agent.os ? `Tu equipo (${agent.os})` : `Estación ${index + 1}`}
        </Text>
        <StatusDot
          level={agent.status === "online" ? "online" : "offline"}
          label={agent.status === "online" ? "Conectado" : `Desconectado — visto ${formatRelativeTime(agent.lastSeenAt)}`}
        />
      </View>

      {agent.devices.length === 0 ? (
        <Text className="text-xs text-ink-faint">Sin dispositivos descubiertos todavía.</Text>
      ) : (
        agent.devices.map((device) => (
          <View key={device.id} className="flex-row items-center justify-between rounded-lg bg-surface-3 px-3 py-2">
            <Text className="text-sm text-ink">{device.name}</Text>
            <Text className="text-xs text-ink-faint">{device.kind}</Text>
          </View>
        ))
      )}
    </View>
  );
}
