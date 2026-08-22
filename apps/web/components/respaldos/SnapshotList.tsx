"use client";

import Link from "next/link";
import { Eye, RotateCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SnapshotBadge } from "./SnapshotBadge";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { formatBytes } from "@/lib/respaldos/formatBytes";
import type { DeviceSnapshotView } from "@/lib/respaldos/types";

export function SnapshotList({
  snapshots,
  showDevice = false,
  onRestore,
  onDelete,
  onViewContent,
  restoringId,
  deletingId,
  errorById,
}: {
  snapshots: DeviceSnapshotView[];
  /** /respaldos (todos los dispositivos) lo necesita; la sección embebida en /dispositivo/[id] no repite el nombre del dispositivo que ya está en el título de la página. */
  showDevice?: boolean;
  onRestore: (snapshot: DeviceSnapshotView) => void;
  onDelete: (snapshot: DeviceSnapshotView) => void;
  onViewContent: (snapshot: DeviceSnapshotView) => void;
  restoringId: string | null;
  deletingId: string | null;
  errorById?: Record<string, string>;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {snapshots.map((snapshot) => {
        const busy = restoringId === snapshot.id || deletingId === snapshot.id;
        return (
          <li key={snapshot.id}>
            <Card padding="sm" className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {showDevice && (
                    <Link href={`/dispositivo/${encodeURIComponent(snapshot.deviceId)}`} className="truncate text-sm font-medium text-ink hover:text-accent">
                      {snapshot.deviceName ?? snapshot.deviceId}
                    </Link>
                  )}
                  <SnapshotBadge backupType={snapshot.backupType} />
                </div>
                <p className="truncate text-xs text-ink-faint">
                  {snapshot.label || "Sin descripción"} · {formatRelativeTime(snapshot.createdAt)}
                  {snapshot.backupType === "binary" && ` · ${formatBytes(snapshot.sizeBytes)}`}
                  {snapshot.backupType !== "binary" && snapshot.fileCount !== undefined && ` · ${snapshot.fileCount} archivo(s)`}
                </p>
                {errorById?.[snapshot.id] && <p className="mt-0.5 text-xs text-danger">{errorById[snapshot.id]}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {snapshot.backupType !== "binary" && (
                  <button
                    type="button"
                    title="Ver contenido"
                    aria-label="Ver contenido"
                    disabled={busy}
                    onClick={() => onViewContent(snapshot)}
                    className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  title="Restaurar"
                  aria-label="Restaurar"
                  disabled={busy}
                  onClick={() => onRestore(snapshot)}
                  className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-accent disabled:opacity-50"
                >
                  <RotateCcw className={`h-4 w-4 ${restoringId === snapshot.id ? "animate-spin" : ""}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Eliminar"
                  aria-label="Eliminar"
                  disabled={busy}
                  onClick={() => onDelete(snapshot)}
                  className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
