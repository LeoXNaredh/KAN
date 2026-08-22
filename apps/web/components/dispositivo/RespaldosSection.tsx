"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { PendingConfirmationModal } from "@/components/dashboard/PendingConfirmationModal";
import { SnapshotList } from "@/components/respaldos/SnapshotList";
import { SnapshotContentViewer } from "@/components/respaldos/SnapshotContentViewer";
import { useDeviceSnapshotActions } from "@/lib/respaldos/useDeviceSnapshotActions";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { isConfigOnlyDeviceKind, type DeviceSnapshotView } from "@/lib/respaldos/types";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import type { DeviceCapabilitiesView } from "@/lib/secuencias/types";

const PROJECT_SAVE_SNAPSHOT = "project_save_snapshot";
const COMPILE_AND_UPLOAD = "compile_and_upload";

/**
 * Backup/restore de proyecto (docs/06) para UN dispositivo — embebida en
 * DispositivoClient.tsx. Dos caminos posibles según lo que el dispositivo
 * exponga ahora mismo:
 *
 * - `project_save_snapshot` presente entre sus capabilities en vivo
 *   (MicroPython siempre; Arduino/ESP32 solo si el Edge Agent lo configuró
 *   con snapshotTransport) → "Nuevo snapshot"/"Compilar y subir" van por
 *   `kan_run_sequence`, mismo camino que cualquier actuador.
 * - Si NO hay esa capability, pero el `deviceKind` es uno de los que solo
 *   soportan config (PLC/Modbus/OPC-UA, tabla estática — no tienen ninguna
 *   capability de proyecto real) → "Nuevo snapshot" va directo a
 *   /api/respaldos/config, sin pasar por ninguna capability.
 *
 * Los snapshots YA GUARDADOS se siguen mostrando aunque el dispositivo esté
 * desconectado ahora mismo (solo "Nuevo snapshot" requiere que esté en
 * vivo) — ver un backup viejo o intentar restaurarlo no debería depender de
 * que el dispositivo esté conectado en este preciso momento.
 */
export function RespaldosSection({ deviceId, deviceName }: { deviceId: string; deviceName: string | null }) {
  const { status } = useSystemStatusContext();
  const edgeAgent = status?.edgeAgents.find((a) => a.devices.some((d) => d.id === deviceId));
  const deviceKind = edgeAgent?.devices.find((d) => d.id === deviceId)?.kind;

  const [snapshots, setSnapshots] = useState<DeviceSnapshotView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveCapabilityRef, setSaveCapabilityRef] = useState<string | null>(null);
  const [compileCapabilityRef, setCompileCapabilityRef] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DeviceSnapshotView | null>(null);

  const [backupType, setBackupType] = useState<"source" | "binary">("source");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [fqbn, setFqbn] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [snapshotsRes, capabilitiesRes] = await Promise.all([
        fetch(`/api/respaldos?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" }),
        fetch("/api/capabilities", { cache: "no-store" }),
      ]);
      const snapshotsData = await snapshotsRes.json();
      setSnapshots(snapshotsData.snapshots ?? []);

      const capabilitiesData = await capabilitiesRes.json();
      const devices: DeviceCapabilitiesView[] = capabilitiesData.devices ?? [];
      const device = devices.find((d) => d.deviceId === deviceId);
      setSaveCapabilityRef(device?.capabilities.find((c) => c.name === PROJECT_SAVE_SNAPSHOT)?.ref ?? null);
      setCompileCapabilityRef(device?.capabilities.find((c) => c.name === COMPILE_AND_UPLOAD)?.ref ?? null);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { restore, resolvePending, remove, restoringId, deletingId, pending, resolving, errorById } = useDeviceSnapshotActions(load);

  const supportsProjectFlow = saveCapabilityRef !== null;
  const supportsConfigFlow = !supportsProjectFlow && deviceKind !== undefined && isConfigOnlyDeviceKind(deviceKind);
  const canCreateNew = supportsProjectFlow || supportsConfigFlow;

  async function saveSnapshot() {
    setSaving(true);
    setSaveError(null);
    try {
      if (supportsProjectFlow && saveCapabilityRef) {
        const input = deviceKind === "esp32-arduino" ? { backupType } : {};
        const response = await fetch("/api/tools/kan_run_sequence/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: { steps: [{ capabilityRef: saveCapabilityRef, input }] } }),
        });
        const data = await response.json();
        const step = data?.data?.steps?.[0];
        if (step?.outcome !== "done") {
          setSaveError(step?.error ?? data?.error ?? "No se pudo guardar el snapshot.");
          return;
        }
      } else if (supportsConfigFlow) {
        const response = await fetch("/api/respaldos/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, deviceKind, deviceName, edgeAgentId: edgeAgent?.id }),
        });
        const data = await response.json();
        if (!response.ok) {
          setSaveError(data.error ?? "No se pudo guardar el snapshot.");
          return;
        }
      }
      await load();
    } catch {
      setSaveError("KAN no está disponible en este momento.");
    } finally {
      setSaving(false);
    }
  }

  async function compileAndUpload() {
    if (!compileCapabilityRef) return;
    setCompiling(true);
    setCompileResult(null);
    try {
      const input = fqbn.trim() ? { fqbn: fqbn.trim() } : {};
      const response = await fetch("/api/tools/kan_run_sequence/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: { steps: [{ capabilityRef: compileCapabilityRef, input }] } }),
      });
      const data = await response.json();
      const step = data?.data?.steps?.[0];
      if (step?.outcome === "done") {
        setCompileResult({ ok: true, message: "Compilado y subido correctamente." });
      } else {
        setCompileResult({ ok: false, message: step?.error ?? data?.error ?? "No se pudo compilar/subir." });
      }
    } catch {
      setCompileResult({ ok: false, message: "KAN no está disponible en este momento." });
    } finally {
      setCompiling(false);
    }
  }

  if (!loading && !canCreateNew && snapshots.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-ink">Respaldos</h2>
      <Card padding="sm" className="flex flex-col gap-4">
        {loading && <SkeletonCard />}

        {!loading && (
          <>
            {canCreateNew ? (
              <div className="flex flex-wrap items-center gap-2">
                {supportsProjectFlow && deviceKind === "esp32-arduino" && (
                  <select
                    value={backupType}
                    onChange={(e) => setBackupType(e.target.value as "source" | "binary")}
                    className={INPUT_CLASSES}
                  >
                    <option value="source">Código fuente (.ino)</option>
                    <option value="binary">Binario completo (dump de flash)</option>
                  </select>
                )}
                <button type="button" disabled={saving} onClick={() => void saveSnapshot()} className={PRIMARY_BUTTON_CLASSES}>
                  {saving ? "Guardando…" : "Nuevo snapshot"}
                </button>
              </div>
            ) : (
              <p className="text-xs text-ink-faint">
                Este dispositivo no está conectado ahora mismo — no se puede iniciar un snapshot nuevo, pero podés ver/restaurar los que ya tenés.
              </p>
            )}
            {saveError && <p className="text-xs text-danger">{saveError}</p>}

            {compileCapabilityRef && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
                <input
                  type="text"
                  value={fqbn}
                  onChange={(e) => setFqbn(e.target.value)}
                  placeholder='fqbn (ej. "esp32:esp32:esp32") — opcional si KAN_ESP32_FQBN ya está configurado'
                  className={`${INPUT_CLASSES} min-w-0 flex-1`}
                />
                <button type="button" disabled={compiling} onClick={() => void compileAndUpload()} className={SECONDARY_BUTTON_CLASSES}>
                  {compiling ? "Compilando…" : "Compilar y subir"}
                </button>
              </div>
            )}
            {compileResult && <p className={`text-xs ${compileResult.ok ? "text-success" : "text-danger"}`}>{compileResult.message}</p>}

            {snapshots.length === 0 ? (
              <p className="text-sm text-ink-faint">Todavía no hay ningún snapshot guardado para este dispositivo.</p>
            ) : (
              <SnapshotList
                snapshots={snapshots}
                onRestore={restore}
                onDelete={remove}
                onViewContent={setViewing}
                restoringId={restoringId}
                deletingId={deletingId}
                errorById={errorById}
              />
            )}
          </>
        )}
      </Card>

      {viewing && <SnapshotContentViewer snapshot={viewing} onClose={() => setViewing(null)} />}
      {pending && (
        <PendingConfirmationModal
          confirmation={pending}
          busy={resolving}
          onCancel={() => void resolvePending(false)}
          onConfirm={() => void resolvePending(true)}
        />
      )}
    </div>
  );
}
