import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { fetchSensors, pollSensors } from "../../lib/telemetry/telemetryApi";
import { listAlerts } from "../../lib/alerts/alertsApi";
import { formatRelativeTime } from "../../lib/status/formatRelativeTime";
import type { SensorSummaryView, TelemetryPollResult } from "../../lib/telemetry/types";

// Más espaciado que los 5s de /sensores en apps/web (SensoresClient.tsx) a
// propósito, por consumo de batería en un dispositivo móvil — mismo pedido
// explícito.
const POLL_INTERVAL_MS = 10_000;

function mergeSensors(catalog: SensorSummaryView[], pollResults: TelemetryPollResult[]): SensorSummaryView[] {
  const now = new Date().toISOString();
  return catalog.map((sensor) => {
    const result = pollResults.find((r) => r.ref === sensor.ref);
    if (result?.success && result.value !== undefined) {
      return { ...sensor, connected: true, latest: { value: result.value, at: now } };
    }
    if (result && !result.success) {
      return { ...sensor, connected: false };
    }
    return sensor;
  });
}

/**
 * Sensores (versión mínima) — mismos endpoints que /sensores en apps/web
 * (GET /api/telemetry para el catálogo, POST /api/telemetry/poll para los
 * valores frescos), sin el detalle histórico con gráfico (SensorChart es
 * SVG web, fuera de alcance acá). La unidad de cada valor sale de
 * kan_list_alerts si existe una alerta configurada para ese sensor — mismo
 * criterio que SensoresClient.tsx: nunca se inventa una unidad.
 */
export default function SensoresScreen() {
  const [sensors, setSensors] = useState<SensorSummaryView[]>([]);
  const [unitByRef, setUnitByRef] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const catalog = await fetchSensors();
      if (cancelled) return;

      const refs = catalog.map((sensor) => sensor.ref);
      const [pollResults, alertsResult] = await Promise.all([pollSensors(refs), listAlerts()]);
      if (cancelled) return;

      setSensors(mergeSensors(catalog, pollResults));
      const units: Record<string, string | undefined> = {};
      for (const alert of alertsResult.alerts) units[alert.capabilityRef] = alert.unit;
      setUnitByRef(units);
      setLoading(false);
    }

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <Text className="text-lg font-semibold text-ink">Sensores</Text>

      {loading && sensors.length === 0 && (
        <View className="items-center py-8">
          <ActivityIndicator color="#0ea5e9" />
        </View>
      )}

      {!loading && sensors.length === 0 && (
        <Text className="text-sm text-ink-faint">Ningún sensor disponible todavía.</Text>
      )}

      {sensors.map((sensor) => (
        <SensorCard key={sensor.ref} sensor={sensor} unit={unitByRef[sensor.ref]} />
      ))}
    </ScrollView>
  );
}

function SensorCard({ sensor, unit }: { sensor: SensorSummaryView; unit?: string }) {
  return (
    <View className="gap-1 rounded-xl border border-line bg-surface-2 p-3">
      <Text className="text-sm font-medium text-ink">{sensor.description}</Text>
      <Text className="text-xs text-ink-faint">{sensor.deviceName}</Text>

      {sensor.latest ? (
        <Text className="text-2xl font-semibold text-ink">
          {sensor.latest.value}
          {unit ? <Text className="text-sm font-normal text-ink-faint"> {unit}</Text> : null}
        </Text>
      ) : (
        <Text className="text-sm text-ink-faint">Esperando la primera lectura…</Text>
      )}

      <Text className="text-xs text-ink-faint">
        {sensor.connected
          ? sensor.latest
            ? `Actualizado ${formatRelativeTime(sensor.latest.at)}`
            : "Conectado"
          : sensor.latest
            ? `Última lectura ${formatRelativeTime(sensor.latest.at)} — desconectado`
            : "Desconectado"}
      </Text>
    </View>
  );
}
