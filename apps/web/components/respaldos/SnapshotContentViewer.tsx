"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SkeletonText } from "@/components/ui/Skeleton";
import type { ConfigSnapshotContent, DeviceSnapshotView, SourceSnapshotContent } from "@/lib/respaldos/types";

/**
 * "Ver contenido" para un snapshot 'source' (lista de archivos + contenido
 * en texto plano, sin syntax highlighting — alcance suficiente para este
 * incremento) o 'config' (lista de reglas de alerta respaldadas). Nunca se
 * monta para 'binary' — SnapshotList no ofrece este botón para ese tipo.
 */
export function SnapshotContentViewer({ snapshot, onClose }: { snapshot: DeviceSnapshotView; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<SourceSnapshotContent | ConfigSnapshotContent | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/respaldos/${encodeURIComponent(snapshot.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error ?? "No se pudo cargar el contenido.");
          return;
        }
        setContent(data.content);
        if (data.content?.files?.length) setSelectedPath(data.content.files[0].path);
      } catch {
        if (!cancelled) setError("KAN no está disponible en este momento.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [snapshot.id]);

  const isSource = snapshot.backupType === "source";
  const sourceContent = isSource ? (content as SourceSnapshotContent | null) : null;
  const configContent = !isSource ? (content as ConfigSnapshotContent | null) : null;
  const selectedFile = sourceContent?.files.find((f) => f.path === selectedPath);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card padding="lg" className="flex max-h-[85vh] w-full max-w-2xl flex-col">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">{snapshot.deviceName ?? snapshot.deviceId}</p>
            <p className="text-xs text-ink-faint">{snapshot.label || "Sin descripción"}</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {loading && (
          <div className="flex flex-col gap-2">
            <SkeletonText />
            <SkeletonText className="w-3/4" />
          </div>
        )}

        {!loading && error && <p className="text-sm text-danger">{error}</p>}

        {!loading && !error && sourceContent && (
          <div className="flex min-h-0 flex-1 gap-3">
            <ul className="kan-scroll flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line/60 pr-2">
              {sourceContent.files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`press w-full truncate rounded-md px-2 py-1 text-left text-xs transition-colors ${
                      file.path === selectedPath ? "bg-surface-3 text-ink" : "text-ink-faint hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>
            <pre className="kan-scroll min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-3/60 p-3 text-xs text-ink">
              {selectedFile?.content ?? "Seleccioná un archivo."}
            </pre>
          </div>
        )}

        {!loading && !error && configContent && (
          <div className="kan-scroll flex-1 overflow-y-auto">
            {configContent.alertRules.length === 0 ? (
              <p className="text-sm text-ink-faint">Este snapshot no tenía ninguna regla de alerta guardada.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {configContent.alertRules.map((rule) => (
                  <li key={rule.id} className="rounded-md bg-surface-3/60 px-3 py-2 text-sm text-ink">
                    {rule.label} {rule.comparator === "above" ? "supera" : "baja de"} {rule.threshold}
                    {rule.unit ? ` ${rule.unit}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
