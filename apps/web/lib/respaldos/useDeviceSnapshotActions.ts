"use client";

import { useCallback, useState } from "react";
import type { PendingConfirmation } from "@/lib/chat/useConversation";
import type { DeviceCapabilitiesView } from "@/lib/secuencias/types";
import type { DeviceSnapshotView } from "./types";

const PROJECT_RESTORE_SNAPSHOT = "project_restore_snapshot";

/**
 * Restaurar/eliminar un snapshot (docs/06) — compartido entre /respaldos
 * (todos los dispositivos) y la sección embebida en /dispositivo/[id], para
 * no duplicar esta lógica en dos lugares. Restaurar toma un camino distinto
 * según el tipo:
 *
 * - 'config' (PLC/Modbus/OPC-UA): ruta directa del Gateway, sin capability
 *   ni severidad de por medio (nunca toca el dispositivo físico) — la
 *   confirmación es un `window.confirm()` simple acá mismo.
 * - 'source'/'binary' (MicroPython/Arduino): es la capability
 *   `project_restore_snapshot` de ESE dispositivo — mismo camino que
 *   cualquier actuador (`kan_run_sequence`, ver DispositivoClient.tsx), así
 *   que reusa el mismo flujo de `PendingConfirmationModal` (la capability ya
 *   es `irreversible-material`, sin código nuevo de confirmación). Si el
 *   dispositivo no está conectado ahora mismo, no hay capability que invocar
 *   — se lo reporta como error en vez de intentarlo.
 */
export function useDeviceSnapshotActions(onChanged: () => void) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ snapshotId: string; confirmation: PendingConfirmation } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const setError = useCallback((id: string, message: string) => {
    setErrorById((prev) => ({ ...prev, [id]: message }));
  }, []);

  const clearError = useCallback((id: string) => {
    setErrorById((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const restore = useCallback(
    async (snapshot: DeviceSnapshotView) => {
      clearError(snapshot.id);
      setRestoringId(snapshot.id);
      try {
        if (snapshot.backupType === "config") {
          const label = snapshot.deviceName ?? snapshot.deviceId;
          if (!window.confirm(`¿Restaurar la configuración guardada de "${label}"? Sobrescribe las reglas de alerta actuales que coincidan.`)) {
            return;
          }
          const response = await fetch(`/api/respaldos/${encodeURIComponent(snapshot.id)}/restore-config`, { method: "POST" });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(snapshot.id, data.error ?? "No se pudo restaurar.");
            return;
          }
          onChanged();
          return;
        }

        const capabilitiesRes = await fetch("/api/capabilities", { cache: "no-store" });
        const capabilitiesData = await capabilitiesRes.json();
        const devices: DeviceCapabilitiesView[] = capabilitiesData.devices ?? [];
        const device = devices.find((d) => d.deviceId === snapshot.deviceId);
        const capability = device?.capabilities.find((c) => c.name === PROJECT_RESTORE_SNAPSHOT);
        if (!capability) {
          setError(snapshot.id, "El dispositivo no está conectado ahora mismo — hace falta que esté en línea para restaurar.");
          return;
        }

        const response = await fetch("/api/tools/kan_run_sequence/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: { steps: [{ capabilityRef: capability.ref, input: { snapshotId: snapshot.id } }] } }),
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
            snapshotId: snapshot.id,
            confirmation: {
              type: "pending_confirmation",
              confirmationId: confirmationData.confirmationId,
              deviceId: confirmationData.deviceId,
              capabilityName: confirmationData.capabilityName,
              input: confirmationData.input,
              severity: confirmationData.severity,
            },
          });
          return;
        }

        const step = data?.data?.steps?.[0];
        if (step?.outcome !== "done") {
          setError(snapshot.id, step?.error ?? data?.error ?? "No se pudo restaurar.");
          return;
        }
        onChanged();
      } catch {
        setError(snapshot.id, "KAN no está disponible en este momento.");
      } finally {
        setRestoringId(null);
      }
    },
    [clearError, onChanged, setError],
  );

  const resolvePending = useCallback(
    async (approved: boolean) => {
      if (!pending) return;
      setResolving(true);
      try {
        const response = await fetch(`/api/confirmations/${encodeURIComponent(pending.confirmation.confirmationId)}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        });
        const data = await response.json();
        if (approved) {
          if (data?.success) onChanged();
          else setError(pending.snapshotId, data?.error ?? "No se pudo restaurar.");
        }
      } catch {
        if (approved) setError(pending.snapshotId, "KAN no está disponible en este momento.");
      } finally {
        setResolving(false);
        setPending(null);
      }
    },
    [pending, onChanged, setError],
  );

  const remove = useCallback(
    async (snapshot: DeviceSnapshotView) => {
      if (!window.confirm(`¿Eliminar este snapshot de "${snapshot.deviceName ?? snapshot.deviceId}"? No se puede deshacer.`)) return;
      clearError(snapshot.id);
      setDeletingId(snapshot.id);
      try {
        const response = await fetch(`/api/respaldos/${encodeURIComponent(snapshot.id)}`, { method: "DELETE" });
        if (response.status !== 204) {
          const data = await response.json().catch(() => ({}));
          setError(snapshot.id, data.error ?? "No se pudo eliminar.");
          return;
        }
        onChanged();
      } catch {
        setError(snapshot.id, "KAN no está disponible en este momento.");
      } finally {
        setDeletingId(null);
      }
    },
    [clearError, onChanged, setError],
  );

  return {
    restore,
    resolvePending,
    remove,
    restoringId,
    deletingId,
    pending: pending?.confirmation ?? null,
    resolving,
    errorById,
  };
}
