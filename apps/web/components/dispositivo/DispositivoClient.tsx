"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Cpu, TriangleAlert, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PendingConfirmationModal } from "@/components/dashboard/PendingConfirmationModal";
import { ActuatorControl } from "@/components/control/ActuatorControl";
import { SensorChart } from "@/components/sensores/SensorChart";
import { useDeviceState } from "@/lib/dispositivo/useDeviceState";
import type { PendingConfirmation } from "@/lib/chat/useConversation";
import type { TelemetryReadingView } from "@/lib/sensores/types";

interface ControlResult {
  status: "running" | "done" | "failed";
  error?: string;
}

const SEVERITY_CARD_CLASSES: Record<string, string> = {
  "irreversible-material": "border-warning/50",
  "safety-critical": "border-danger/50",
};

const SEVERITY_BADGE: Record<string, { label: string; classes: string }> = {
  "irreversible-material": { label: "Mueve algo físico", classes: "bg-warning/10 text-warning" },
  "safety-critical": { label: "Acción crítica", classes: "bg-danger/10 text-danger" },
};

// Mismo intervalo de refresco de historial que SensoresClient.tsx.
const HISTORY_POLL_INTERVAL_MS = 5_000;

/**
 * Vista unificada de un dispositivo: sensores (con gráficas) + actuadores en
 * la misma pantalla, con estado compartido vía useDeviceState() — a
 * diferencia de /sensores y /control (independientes entre sí), acá
 * ejecutar un actuador dispara `refreshNow()` para refrescar los sensores de
 * inmediato en vez de esperar el próximo tick de 5s.
 */
export function DispositivoClient({ deviceId }: { deviceId: string }) {
  const { deviceName, connected, sensors, actuators, loading, gatewayOnline, refreshNow } = useDeviceState(deviceId);
  const [results, setResults] = useState<Record<string, ControlResult>>({});
  const [pending, setPending] = useState<{ ref: string; confirmation: PendingConfirmation } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [history, setHistory] = useState<TelemetryReadingView[]>([]);

  useEffect(() => {
    if (!selectedRef) return;
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch(`/api/telemetry/${encodeURIComponent(selectedRef!)}/history`, { cache: "no-store" });
        const data = await response.json();
        if (!cancelled) setHistory(data.readings ?? []);
      } catch {
        if (!cancelled) setHistory([]);
      }
    }

    loadHistory();
    const interval = setInterval(loadHistory, HISTORY_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedRef]);

  const selectedSensor = useMemo(() => sensors.find((s) => s.ref === selectedRef), [sensors, selectedRef]);

  async function execute(ref: string, input: Record<string, unknown>) {
    setResults((prev) => ({ ...prev, [ref]: { status: "running" } }));
    try {
      const response = await fetch("/api/tools/kan_run_sequence/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: { steps: [{ capabilityRef: ref, input }] } }),
      });
      const data = await response.json();

      if (data?.requiresConfirmation) {
        const confirmationData = (data.data ?? {}) as {
          confirmationId: string;
          deviceId: string;
          capabilityName: string;
          input: unknown;
          severity: PendingConfirmation["severity"];
        };
        setPending({
          ref,
          confirmation: {
            type: "pending_confirmation",
            confirmationId: confirmationData.confirmationId,
            deviceId: confirmationData.deviceId,
            capabilityName: confirmationData.capabilityName,
            input: confirmationData.input,
            severity: confirmationData.severity,
          },
        });
        setResults((prev) => {
          const next = { ...prev };
          delete next[ref];
          return next;
        });
        return;
      }

      const step = data?.data?.steps?.[0];
      if (step?.outcome === "done") {
        setResults((prev) => ({ ...prev, [ref]: { status: "done" } }));
      } else {
        setResults((prev) => ({ ...prev, [ref]: { status: "failed", error: step?.error ?? data?.error ?? "No se pudo ejecutar." } }));
      }
      // Refresca los sensores del dispositivo ya, sin esperar el próximo
      // tick de 5s — no hay metadata que vincule esta capability con "el"
      // sensor relacionado, así que se refresca el dispositivo entero.
      refreshNow();
    } catch {
      setResults((prev) => ({ ...prev, [ref]: { status: "failed", error: "KAN no está disponible en este momento." } }));
    }
  }

  async function resolvePending(approved: boolean) {
    if (!pending) return;
    setResolving(true);
    const { ref, confirmation } = pending;
    try {
      const response = await fetch(`/api/confirmations/${encodeURIComponent(confirmation.confirmationId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      const data = await response.json();
      if (approved) {
        setResults((prev) => ({
          ...prev,
          [ref]: data?.success ? { status: "done" } : { status: "failed", error: data?.error ?? "No se pudo ejecutar." },
        }));
        refreshNow();
      }
    } catch {
      if (approved) {
        setResults((prev) => ({ ...prev, [ref]: { status: "failed", error: "KAN no está disponible en este momento." } }));
      }
    } finally {
      setResolving(false);
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/control"
          aria-label="Volver"
          className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Cpu className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold text-ink">{deviceName ?? "Dispositivo"}</h1>
          <p className="text-sm text-ink-faint">{connected ? "Conectado" : "Desconectado"}</p>
        </div>
      </div>

      {!gatewayOnline && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          KAN no está disponible en este momento — no se pueden ver ni accionar dispositivos ahora mismo.
        </div>
      )}

      {loading && sensors.length === 0 && actuators.length === 0 && (
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && sensors.length === 0 && actuators.length === 0 && (
        <EmptyState
          icon={Cpu}
          title="Sin capabilities todavía"
          description="Este dispositivo no tiene sensores ni actuadores detectados por ahora."
        />
      )}

      {sensors.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">Sensores</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sensors.map((sensor) => (
              <button key={sensor.ref} type="button" onClick={() => setSelectedRef(sensor.ref)} className="text-left">
                <Card interactive padding="sm" className="flex h-full flex-col gap-2">
                  <p className="truncate text-sm font-medium text-ink">{sensor.description}</p>
                  {sensor.latest ? (
                    <p className="text-2xl font-semibold tracking-tight text-ink">{sensor.latest.value}</p>
                  ) : (
                    <p className="text-sm text-ink-faint">Esperando la primera lectura…</p>
                  )}
                  <p className="mt-auto text-xs text-ink-faint">{sensor.connected ? "Conectado" : "Desconectado"}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      )}

      {actuators.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">Actuadores</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {actuators.map((capability) => {
              const result = results[capability.ref];
              const badge = SEVERITY_BADGE[capability.severity];
              return (
                <Card
                  key={capability.ref}
                  padding="sm"
                  className={`flex flex-col gap-3 ${SEVERITY_CARD_CLASSES[capability.severity] ?? ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink">{capability.description}</p>
                    {badge && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.classes}`}>{badge.label}</span>
                    )}
                  </div>

                  <ActuatorControl
                    capability={capability}
                    disabled={result?.status === "running"}
                    onExecute={(input) => execute(capability.ref, input)}
                  />

                  {result && (
                    <p className={`text-xs ${result.status === "failed" ? "text-danger" : result.status === "done" ? "text-success" : "text-ink-faint"}`}>
                      {result.status === "running" && "Ejecutando…"}
                      {result.status === "done" && "✓ Hecho"}
                      {result.status === "failed" && `✗ Falló: ${result.error}`}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {selectedSensor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card padding="lg" className="w-full max-w-lg">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{selectedSensor.description}</p>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setSelectedRef(null)}
                className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <SensorChart readings={history} />
          </Card>
        </div>
      )}

      {pending && (
        <PendingConfirmationModal
          confirmation={pending.confirmation}
          busy={resolving}
          onCancel={() => void resolvePending(false)}
          onConfirm={() => void resolvePending(true)}
        />
      )}
    </div>
  );
}
