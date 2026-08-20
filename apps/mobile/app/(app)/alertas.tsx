import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { cancelAlert, formatAlertText, listAlerts } from "../../lib/alerts/alertsApi";
import type { AlertView } from "../../lib/alerts/types";

/**
 * Alertas (versión mínima, solo lectura + cancelar) — mismo
 * kan_list_alerts/kan_cancel_alert vía /api/tools/[name]/execute que ya usa
 * SecuenciasClient.tsx en apps/web (creación de alertas queda fuera de
 * alcance acá: requiere el picker de capabilities/sensores, que no existe
 * en mobile todavía).
 */
export default function AlertasScreen() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await listAlerts();
      if (cancelled) return;
      setAlerts(result.alerts);
      setGatewayOnline(result.gatewayOnline);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function handleCancel(alertId: string) {
    await cancelAlert(alertId);
    setReloadKey((k) => k + 1);
  }

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <Text className="text-lg font-semibold text-ink">Alertas</Text>

      {!gatewayOnline && !loading && (
        <Text className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          No se pudo contactar al Gateway. La lista puede estar incompleta.
        </Text>
      )}

      {loading && (
        <View className="items-center py-8">
          <ActivityIndicator color="#0ea5e9" />
        </View>
      )}

      {!loading && alerts.length === 0 && (
        <Text className="text-sm text-ink-faint">No tenés alertas activas.</Text>
      )}

      {alerts.map((alert) => (
        <View
          key={alert.alertId}
          className="flex-row items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3"
        >
          <Text className="flex-1 text-sm text-ink">{formatAlertText(alert)}</Text>
          <Pressable onPress={() => handleCancel(alert.alertId)}>
            <Text className="text-xs text-danger">Cancelar</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
