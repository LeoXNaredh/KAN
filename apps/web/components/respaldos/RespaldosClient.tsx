"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { PendingConfirmationModal } from "@/components/dashboard/PendingConfirmationModal";
import { SnapshotList } from "./SnapshotList";
import { SnapshotContentViewer } from "./SnapshotContentViewer";
import { useDeviceSnapshotActions } from "@/lib/respaldos/useDeviceSnapshotActions";
import type { DeviceSnapshotView } from "@/lib/respaldos/types";

export function RespaldosClient() {
  const [snapshots, setSnapshots] = useState<DeviceSnapshotView[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<DeviceSnapshotView | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/respaldos", { cache: "no-store" });
      const data = await response.json();
      setSnapshots(data.snapshots ?? []);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { restore, resolvePending, remove, restoringId, deletingId, pending, resolving, errorById } = useDeviceSnapshotActions(load);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Respaldos</h1>
        <p className="text-sm text-ink-faint">
          Backups del código o la configuración de tus dispositivos — MicroPython, Arduino/ESP32 y PLCs (Modbus/OPC-UA), cada uno con su propio tipo de
          backup.
        </p>
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && snapshots.length === 0 && (
        <EmptyState
          icon={Archive}
          title="Todavía no hay ningún respaldo"
          description="Andá al panel de un dispositivo (MicroPython, Arduino/ESP32 o un PLC) y usá 'Nuevo snapshot' para guardar el primero."
          action={{ label: "Ver dispositivos", href: "/dispositivos" }}
        />
      )}

      {!loading && snapshots.length > 0 && (
        <SnapshotList
          snapshots={snapshots}
          showDevice
          onRestore={restore}
          onDelete={remove}
          onViewContent={setViewing}
          restoringId={restoringId}
          deletingId={deletingId}
          errorById={errorById}
        />
      )}

      {viewing && <SnapshotContentViewer snapshot={viewing} onClose={() => setViewing(null)} />}

      {pending && (
        <PendingConfirmationModal confirmation={pending} busy={resolving} onCancel={() => void resolvePending(false)} onConfirm={() => void resolvePending(true)} />
      )}
    </div>
  );
}
