"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Bell, Play, Plus, TriangleAlert, Trash2, Workflow, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { SkeletonText } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ParamField } from "@/components/ui/ParamField";
import type {
  AlertView,
  CapabilityView,
  DeviceCapabilitiesView,
  SavedSequence,
  SequenceStepReportView,
  SequenceStepView,
} from "@/lib/secuencias/types";

// localStorage, no una tabla nueva: ni kan_run_sequence (ejecuta y devuelve,
// no persiste nada) ni kan_set_alert (persiste una AlertRule, pero su
// `label` es la frase del sensor, no un "nombre de secuencia") tienen un
// concepto de "secuencia con nombre" del lado del servidor para el caso
// manual — ver plan. Mismo criterio try/catch que el resto del repo.
const SAVED_SEQUENCES_KEY = "kan:saved-sequences";

interface StepDraft {
  deviceId: string;
  capabilityRef: string;
  input: Record<string, unknown>;
}

function emptyStep(): StepDraft {
  return { deviceId: "", capabilityRef: "", input: {} };
}

// useSyncExternalStore (no useEffect+setState, mismo criterio que
// DashboardClient.tsx/useIsClient/ThemeAccentPicker): evita el mismatch de
// hidratación de leer localStorage recién en un efecto y el re-render en
// cascada que dispara react-hooks/set-state-in-effect. El snapshot del
// cliente se cachea en un módulo-level var (no un array literal nuevo por
// llamada) porque useSyncExternalStore exige una referencia estable entre
// renders sin cambios reales.
const EMPTY_SAVED_SEQUENCES: SavedSequence[] = [];
let savedSequencesCache: SavedSequence[] | null = null;
let savedSequencesListeners: Array<() => void> = [];

function readSavedSequencesFromStorage(): SavedSequence[] {
  try {
    const raw = window.localStorage.getItem(SAVED_SEQUENCES_KEY);
    return raw ? (JSON.parse(raw) as SavedSequence[]) : [];
  } catch {
    return [];
  }
}

function subscribeSavedSequences(listener: () => void): () => void {
  savedSequencesListeners.push(listener);
  return () => {
    savedSequencesListeners = savedSequencesListeners.filter((l) => l !== listener);
  };
}

function getSavedSequencesServerSnapshot(): SavedSequence[] {
  return EMPTY_SAVED_SEQUENCES;
}

function getSavedSequencesClientSnapshot(): SavedSequence[] {
  if (savedSequencesCache === null) savedSequencesCache = readSavedSequencesFromStorage();
  return savedSequencesCache;
}

function persistSavedSequences(sequences: SavedSequence[]) {
  savedSequencesCache = sequences;
  try {
    window.localStorage.setItem(SAVED_SEQUENCES_KEY, JSON.stringify(sequences));
  } catch {
    // Sin storage no se puede guardar — ejecutar sigue funcionando igual, no es grave.
  }
  savedSequencesListeners.forEach((listener) => listener());
}

const OUTCOME_LABEL: Record<SequenceStepReportView["outcome"], string> = {
  done: "Hecho",
  failed: "Falló",
  pending_confirmation: "Necesita confirmación",
};

const OUTCOME_COLOR: Record<SequenceStepReportView["outcome"], string> = {
  done: "text-success",
  failed: "text-danger",
  pending_confirmation: "text-warning",
};

/**
 * Constructor visual de secuencias: arma los argumentos de kan_run_sequence
 * (ejecutar ahora) y kan_set_alert (guardar con condición) con selects y
 * formularios generados desde `inputSchema`, sin exponer JSON ni IDs
 * técnicos — mismo esqueleto que AutomatizacionesClient.tsx (fetch inicial,
 * Card por sección, reloadKey para refetch), pero sin textarea JSON libre.
 */
export function SecuenciasClient() {
  const [devices, setDevices] = useState<DeviceCapabilitiesView[]>([]);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
  const [mode, setMode] = useState<"manual" | "condition">("manual");
  const [conditionCapabilityRef, setConditionCapabilityRef] = useState("");
  const [comparator, setComparator] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");

  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<SequenceStepReportView[] | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const savedSequences = useSyncExternalStore(
    subscribeSavedSequences,
    getSavedSequencesClientSnapshot,
    getSavedSequencesServerSnapshot,
  );
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    async function loadAlerts() {
      setAlertsLoading(true);
      try {
        const response = await fetch("/api/tools/kan_list_alerts/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: {} }),
        });
        const data = await response.json();
        if (cancelled) return;
        setAlerts(data?.data?.alerts ?? []);
      } catch {
        if (!cancelled) setAlerts([]);
      } finally {
        if (!cancelled) setAlertsLoading(false);
      }
    }
    loadAlerts();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const capabilityByRef = useMemo(() => {
    const map = new Map<string, { device: DeviceCapabilitiesView; capability: CapabilityView }>();
    for (const device of devices) {
      for (const capability of device.capabilities) {
        map.set(capability.ref, { device, capability });
      }
    }
    return map;
  }, [devices]);

  const readOnlyCapabilities = useMemo(
    () => Array.from(capabilityByRef.values()).filter((entry) => entry.capability.severity === "read-only"),
    [capabilityByRef],
  );

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function updateStepParam(index: number, key: string, value: unknown) {
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, input: { ...step.input, [key]: value } } : step)),
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }

  function removeStep(index: number) {
    setSteps((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function buildSteps(): SequenceStepView[] | undefined {
    const built: SequenceStepView[] = [];
    for (const step of steps) {
      if (!step.capabilityRef) return undefined;
      built.push({ capabilityRef: step.capabilityRef, input: step.input });
    }
    return built.length > 0 ? built : undefined;
  }

  async function handleRun() {
    setFormError(null);
    setResults(null);
    setNeedsConfirmation(false);
    const built = buildSteps();
    if (!built) {
      setFormError("Elegí un dispositivo y una acción para cada paso.");
      return;
    }

    setRunning(true);
    try {
      const response = await fetch("/api/tools/kan_run_sequence/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: { steps: built } }),
      });
      const data = await response.json();
      const reportedSteps: SequenceStepReportView[] = data?.data?.steps ?? [];
      setResults(reportedSteps);
      setNeedsConfirmation(Boolean(data?.requiresConfirmation));
      if (!data?.success && !data?.requiresConfirmation) {
        setFormError(data?.error ?? "No se pudo ejecutar la secuencia.");
      }
    } catch {
      setFormError("KAN no está disponible en este momento.");
    } finally {
      setRunning(false);
    }
  }

  async function handleSave() {
    setFormError(null);
    const built = buildSteps();
    if (!built) {
      setFormError("Elegí un dispositivo y una acción para cada paso.");
      return;
    }
    if (!name.trim()) {
      setFormError("Dale un nombre a la secuencia antes de guardarla.");
      return;
    }

    if (mode === "manual") {
      persistSavedSequences([
        ...savedSequences,
        { id: crypto.randomUUID(), name: name.trim(), steps: built, createdAt: new Date().toISOString() },
      ]);
      return;
    }

    if (!conditionCapabilityRef) {
      setFormError("Elegí qué sensor vigilar.");
      return;
    }
    const thresholdNumber = Number(threshold);
    if (!threshold.trim() || !Number.isFinite(thresholdNumber)) {
      setFormError("El valor límite tiene que ser un número.");
      return;
    }
    const finalLabel = label.trim() || capabilityByRef.get(conditionCapabilityRef)?.capability.description || name.trim();

    setSaving(true);
    try {
      const response = await fetch("/api/tools/kan_set_alert/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          args: {
            capabilityRef: conditionCapabilityRef,
            comparator,
            threshold: thresholdNumber,
            label: finalLabel,
            unit: unit.trim() || undefined,
            steps: built,
          },
        }),
      });
      const data = await response.json();
      if (!data?.success) {
        setFormError(data?.error ?? "No se pudo crear la alerta.");
        return;
      }
      setReloadKey((key) => key + 1);
    } catch {
      setFormError("KAN no está disponible en este momento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelAlert(alertId: string) {
    await fetch("/api/tools/kan_cancel_alert/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: { alertId } }),
    });
    setReloadKey((key) => key + 1);
  }

  function handleRunSaved(saved: SavedSequence) {
    setSteps(
      saved.steps.map((step) => ({
        deviceId: capabilityByRef.get(step.capabilityRef)?.device.deviceId ?? "",
        capabilityRef: step.capabilityRef,
        input: step.input,
      })),
    );
    setName(saved.name);
    setMode("manual");
    setResults(null);
    setFormError(null);
  }

  function handleDeleteSaved(id: string) {
    persistSavedSequences(savedSequences.filter((sequence) => sequence.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Secuencias</h1>
        <p className="text-sm text-ink-faint">
          Armá una secuencia de acciones sobre tus dispositivos con botones — ejecutala ahora o guardala para cuando
          un sensor cruce un valor.
        </p>
      </div>

      {!gatewayOnline && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          KAN no está disponible en este momento — no se pueden ver dispositivos ni ejecutar secuencias ahora mismo.
        </div>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Nueva secuencia</h2>
        <div className="flex flex-col gap-4">
          <input
            className={INPUT_CLASSES}
            placeholder="Nombre de la secuencia (ej. Apagar todo antes de salir)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-muted">Pasos (se ejecutan en orden; se detiene si uno falla o necesita confirmación)</span>
            {loading && <SkeletonText className="h-9 max-w-xs" />}
            {steps.map((step, index) => {
              const device = devices.find((d) => d.deviceId === step.deviceId);
              const capability = capabilityByRef.get(step.capabilityRef)?.capability;
              const properties = capability?.inputSchema?.properties ?? {};
              const required = capability?.inputSchema?.required ?? [];

              return (
                <div key={index} className="flex flex-col gap-2 rounded-xl border border-line/70 bg-surface-3/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-ink-faint">#{index + 1}</span>
                    <select
                      className={`flex-1 ${INPUT_CLASSES}`}
                      value={step.deviceId}
                      onChange={(event) => updateStep(index, { deviceId: event.target.value, capabilityRef: "", input: {} })}
                      disabled={!gatewayOnline || loading || devices.length === 0}
                    >
                      <option value="">{devices.length === 0 ? "Sin dispositivos disponibles" : "Elegí un dispositivo..."}</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.deviceName}
                        </option>
                      ))}
                    </select>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Quitar paso ${index + 1}`}
                        onClick={() => removeStep(index)}
                        className="press shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {device && (
                    <select
                      className={INPUT_CLASSES}
                      value={step.capabilityRef}
                      onChange={(event) => updateStep(index, { capabilityRef: event.target.value, input: {} })}
                    >
                      <option value="">Elegí qué hacer...</option>
                      {device.capabilities.map((c) => (
                        <option key={c.ref} value={c.ref}>
                          {c.description}
                        </option>
                      ))}
                    </select>
                  )}

                  {capability && Object.keys(properties).length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {Object.entries(properties).map(([key, schema]) => (
                        <ParamField
                          key={key}
                          fieldKey={key}
                          schema={schema}
                          required={required.includes(key)}
                          value={step.input[key]}
                          onChange={(value) => updateStepParam(index, key, value)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addStep}
              className="press flex items-center gap-1.5 self-start rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Agregar paso
            </button>
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-sm text-ink-muted">¿Cuándo se ejecuta?</span>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5 text-ink-muted">
                <input type="radio" checked={mode === "manual"} onChange={() => setMode("manual")} />
                Ejecutar manualmente
              </label>
              <label className="flex items-center gap-1.5 text-ink-muted">
                <input type="radio" checked={mode === "condition"} onChange={() => setMode("condition")} />
                Cuando un sensor cruce un valor
              </label>
            </div>

            {mode === "condition" && (
              <div className="flex flex-col gap-2 rounded-xl border border-line/70 bg-surface-3/60 p-3">
                <select
                  className={INPUT_CLASSES}
                  value={conditionCapabilityRef}
                  onChange={(event) => setConditionCapabilityRef(event.target.value)}
                >
                  <option value="">Elegí un sensor a vigilar...</option>
                  {readOnlyCapabilities.map(({ capability, device }) => (
                    <option key={capability.ref} value={capability.ref}>
                      {device.deviceName} — {capability.description}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setComparator("above")}
                      className={`press rounded-full border px-3 py-1 text-xs transition-colors ${
                        comparator === "above" ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-faint hover:text-ink"
                      }`}
                    >
                      Cuando supere
                    </button>
                    <button
                      type="button"
                      onClick={() => setComparator("below")}
                      className={`press rounded-full border px-3 py-1 text-xs transition-colors ${
                        comparator === "below" ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-faint hover:text-ink"
                      }`}
                    >
                      Cuando baje de
                    </button>
                  </div>
                  <input
                    type="number"
                    className={`w-28 ${INPUT_CLASSES}`}
                    placeholder="Valor"
                    value={threshold}
                    onChange={(event) => setThreshold(event.target.value)}
                  />
                  <input
                    type="text"
                    className={`w-32 ${INPUT_CLASSES}`}
                    placeholder="Unidad (opcional)"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                </div>
                <input
                  type="text"
                  className={INPUT_CLASSES}
                  placeholder="Cómo se llama lo que medís (ej. la temperatura)"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
            )}
          </div>

          {formError && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={handleRun} disabled={running || !gatewayOnline} className={PRIMARY_BUTTON_CLASSES}>
              {running ? "Ejecutando..." : "Ejecutar ahora"}
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !gatewayOnline} className={SECONDARY_BUTTON_CLASSES}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>

          {needsConfirmation && (
            <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Uno de los pasos necesita que confirmes la acción — mirá la campanita de confirmaciones pendientes arriba.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {results.map((step, index) => (
                <li key={index} className="flex flex-col gap-0.5 rounded-lg bg-surface-3/70 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink">
                      {step.deviceName}: {step.description}
                    </span>
                    <span className={`shrink-0 text-xs font-medium ${OUTCOME_COLOR[step.outcome]}`}>{OUTCOME_LABEL[step.outcome]}</span>
                  </div>
                  {step.error && <span className="text-xs text-danger">{step.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Mis secuencias guardadas</h2>
        {savedSequences.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="Todavía no creaste ninguna secuencia"
            description="Armá una arriba y guardala para volver a ejecutarla cuando quieras."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {savedSequences.map((saved) => (
              <li key={saved.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-3/70 px-3 py-2 text-sm">
                <span className="truncate text-ink">{saved.name}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRunSaved(saved)}
                    title="Cargar en el editor"
                    aria-label="Cargar en el editor"
                    className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSaved(saved.id)}
                    title="Eliminar"
                    aria-label="Eliminar"
                    className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Mis alertas</h2>
        {alertsLoading ? (
          <div className="flex flex-col gap-2">
            <SkeletonText className="h-9" />
            <SkeletonText className="h-9" />
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No tenés alertas activas"
            description="Creá una secuencia con condición para que KAN te avise solo."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((alert) => (
              <li key={alert.alertId} className="flex items-center justify-between gap-3 rounded-xl bg-surface-3/70 px-3 py-2 text-sm">
                <span className="text-ink">
                  Avisa cuando {alert.label} {alert.comparator === "above" ? "supere" : "baje de"} {alert.threshold}
                  {alert.unit ? ` ${alert.unit}` : ""}
                  {alert.steps && alert.steps.length > 0
                    ? ` — y ejecuta ${alert.steps.length} paso${alert.steps.length > 1 ? "s" : ""}`
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() => handleCancelAlert(alert.alertId)}
                  aria-label="Cancelar alerta"
                  title="Cancelar alerta"
                  className="press shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
