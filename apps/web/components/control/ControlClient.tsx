"use client";

import { useEffect, useMemo, useState } from "react";
import { Sliders, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PendingConfirmationModal } from "@/components/dashboard/PendingConfirmationModal";
import { ActuatorControl } from "@/components/control/ActuatorControl";
import type { PendingConfirmation } from "@/lib/chat/useConversation";
import type { DeviceCapabilitiesView } from "@/lib/secuencias/types";

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

/**
 * Control manual de actuadores — sin polling (a diferencia de /sensores):
 * esto solo escribe, no necesita refrescar valores en vivo. Cada control
 * ejecuta vía POST /api/tools/kan_run_sequence/execute con un solo paso
 * (mismo BFF que ya usa el constructor de secuencias, allowlist ya incluye
 * kan_run_sequence). Si la respuesta trae requiresConfirmation, se muestra
 * el PendingConfirmationModal REAL (mismo componente/flujo que
 * PendingConfirmationsButton) — nunca un pre-check del lado del cliente:
 * Gateway/ToolExecutor siempre exige la confirmación real para
 * irreversible-material/safety-critical sin importar qué decida el
 * cliente de antemano, así que "confirmar antes de ejecutar" ya está
 * garantizado por el propio backend.
 */
export function ControlClient() {
  const [devices, setDevices] = useState<DeviceCapabilitiesView[]>([]);
  const [loading, setLoading] = useState(true);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [results, setResults] = useState<Record<string, ControlResult>>({});
  const [pending, setPending] = useState<{ ref: string; confirmation: PendingConfirmation } | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/capabilities");
        const data = await response.json();
        if (cancelled) return;
        setDevices(data.devices ?? []);
        setGatewayOnline(response.ok);
      } catch {
        if (!cancelled) {
          setDevices([]);
          setGatewayOnline(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const actionable = useMemo(
    () =>
      devices.flatMap((device) =>
        device.capabilities.filter((capability) => capability.severity !== "read-only").map((capability) => ({ device, capability })),
      ),
    [devices],
  );

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
      <div>
        <h1 className="text-lg font-semibold text-ink">Control</h1>
        <p className="text-sm text-ink-faint">Accioná tus dispositivos directo, sin escribirle a KAN.</p>
      </div>

      {!gatewayOnline && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          KAN no está disponible en este momento — no se pueden ver ni accionar dispositivos ahora mismo.
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && actionable.length === 0 && (
        <EmptyState
          icon={Sliders}
          title="Ningún actuador disponible todavía"
          description="Conectá un dispositivo con capabilities de acción (no solo de lectura) para controlarlo acá."
        />
      )}

      {!loading && actionable.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {actionable.map(({ device, capability }) => {
            const result = results[capability.ref];
            const badge = SEVERITY_BADGE[capability.severity];
            return (
              <Card
                key={capability.ref}
                padding="sm"
                className={`flex flex-col gap-3 ${SEVERITY_CARD_CLASSES[capability.severity] ?? ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{capability.description}</p>
                    <p className="truncate text-xs text-ink-faint">{device.deviceName}</p>
                  </div>
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
