"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bell, Clock, Loader2, Plus, Repeat, Trash2, TriangleAlert, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import type { ScheduledJobView } from "@/lib/jobs/types";

interface ToolOption {
  name: string;
  description: string;
}

interface StepDraft {
  capabilityRef: string;
  inputJson: string;
}

type ScheduleType = "cron" | "once";

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Cada hora", value: "0 * * * *" },
  { label: "Cada 5 min", value: "*/5 * * * *" },
  { label: "Diario a las 8:00", value: "0 8 * * *" },
  { label: "Cada lunes 9:00", value: "0 9 * * 1" },
];

function emptyStep(): StepDraft {
  return { capabilityRef: "", inputJson: "{}" };
}

function formatSchedule(job: ScheduledJobView): string {
  if (job.cron) return `Cron: ${job.cron}`;
  if (job.runAt) return `Una vez: ${new Date(job.runAt).toLocaleString()}`;
  return "—";
}

/**
 * UI de Automatizaciones (P6/ADR-021): conecta con /api/jobs y /api/tools,
 * BFFs finos sobre GET/POST /v1/jobs, DELETE /v1/jobs/:id y GET /v1/tools
 * del Gateway (docs/12 §10). Un job puede tener varios `steps` ("acciones
 * combinadas", ejecutados en orden, se detiene en el primer fallo) y una
 * notificación opcional que se dispara al terminar. Los argumentos de cada
 * step usan un textarea JSON libre en vez de un formulario generado por
 * inputSchema — mismo criterio que ADR-015 con RAG, no sobre-construir
 * antes de que el caso de uso real lo pida.
 */
export function AutomatizacionesClient() {
  const [jobs, setJobs] = useState<ScheduledJobView[]>([]);
  const [tools, setTools] = useState<ToolOption[]>([]);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [loading, setLoading] = useState(true);

  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("cron");
  const [cron, setCron] = useState(CRON_PRESETS[0].value);
  const [runAtLocal, setRunAtLocal] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Bump para forzar un refetch desde un event handler (crear/cancelar) sin
  // llamar setState directo dentro del efecto (react-hooks/set-state-in-effect)
  // — mismo criterio que useSystemStatus.ts/TopBar.tsx.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [jobsResponse, toolsResponse] = await Promise.all([fetch("/api/jobs"), fetch("/api/tools")]);
        const jobsData = await jobsResponse.json();
        const toolsData = await toolsResponse.json();
        if (cancelled) return;
        setJobs(jobsData.jobs ?? []);
        setGatewayOnline(jobsData.gatewayOnline ?? false);
        setTools(toolsData.tools ?? []);
      } catch {
        if (!cancelled) {
          setJobs([]);
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
  }, [reloadKey]);

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }

  function removeStep(index: number) {
    setSteps((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsedSteps: Array<{ capabilityRef: string; input: unknown }> = [];
    for (const [index, step] of steps.entries()) {
      if (!step.capabilityRef) {
        setFormError(`Elegí una capability para el paso ${index + 1}.`);
        return;
      }
      let input: unknown = {};
      if (step.inputJson.trim()) {
        try {
          input = JSON.parse(step.inputJson);
        } catch {
          setFormError(`Los argumentos del paso ${index + 1} no son JSON válido.`);
          return;
        }
      }
      parsedSteps.push({ capabilityRef: step.capabilityRef, input });
    }

    if (scheduleType === "once" && !runAtLocal) {
      setFormError("Elegí una fecha y hora.");
      return;
    }

    if (notifyEnabled && (!notifyTitle.trim() || !notifyBody.trim())) {
      setFormError("La notificación necesita título y mensaje.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: parsedSteps,
          notification: notifyEnabled ? { title: notifyTitle.trim(), body: notifyBody.trim() } : undefined,
          cron: scheduleType === "cron" ? cron : undefined,
          runAt: scheduleType === "once" ? new Date(runAtLocal).toISOString() : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Error desconocido");

      setSteps([emptyStep()]);
      setRunAtLocal("");
      setNotifyEnabled(false);
      setNotifyTitle("");
      setNotifyBody("");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(jobId: string) {
    if (!confirm("¿Cancelar este job programado?")) return;
    await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    setReloadKey((key) => key + 1);
  }

  function toolLabel(ref: string): string {
    return tools.find((tool) => tool.name === ref)?.description ?? ref;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Automatizaciones</h1>
        <p className="text-sm text-ink-faint">
          Programa una o varias capabilities para que KAN las ejecute sola, en orden, con una notificación opcional al terminar.
        </p>
      </div>

      {!gatewayOnline && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          KAN no está disponible en este momento — no se pueden crear ni ver recordatorios ahora mismo.
        </div>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Programar un job nuevo</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-muted">Pasos (se ejecutan en orden; se detiene si uno falla)</span>
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-xl border border-line/70 bg-surface-3/60 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-ink-faint">#{index + 1}</span>
                  <select
                    className={`flex-1 ${INPUT_CLASSES}`}
                    value={step.capabilityRef}
                    onChange={(event) => updateStep(index, { capabilityRef: event.target.value })}
                    disabled={!gatewayOnline || tools.length === 0}
                  >
                    <option value="">{tools.length === 0 ? "Sin capabilities disponibles" : "Elegí una capability..."}</option>
                    {tools.map((tool) => (
                      <option key={tool.name} value={tool.name}>
                        {tool.description || tool.name}
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
                <textarea
                  className={`min-h-[3rem] font-mono text-xs ${INPUT_CLASSES}`}
                  placeholder="Argumentos (JSON, opcional)"
                  value={step.inputJson}
                  onChange={(event) => updateStep(index, { inputJson: event.target.value })}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addStep}
              className="press flex items-center gap-1.5 self-start rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Agregar paso
            </button>
          </div>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5 text-ink-muted">
              <input type="radio" checked={scheduleType === "cron"} onChange={() => setScheduleType("cron")} />
              Recurrente (cron)
            </label>
            <label className="flex items-center gap-1.5 text-ink-muted">
              <input type="radio" checked={scheduleType === "once"} onChange={() => setScheduleType("once")} />
              Una sola vez
            </label>
          </div>

          {scheduleType === "cron" ? (
            <div className="flex flex-col gap-2">
              <input
                className={`font-mono text-sm ${INPUT_CLASSES}`}
                value={cron}
                onChange={(event) => setCron(event.target.value)}
                placeholder="0 8 * * *"
              />
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setCron(preset.value)}
                    className={`press rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      cron === preset.value ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-faint hover:text-ink"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <input
              type="datetime-local"
              className={INPUT_CLASSES}
              value={runAtLocal}
              onChange={(event) => setRunAtLocal(event.target.value)}
            />
          )}

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <label className="flex items-center gap-1.5 text-sm text-ink-muted">
              <input type="checkbox" checked={notifyEnabled} onChange={(event) => setNotifyEnabled(event.target.checked)} />
              Enviar una notificación al terminar
            </label>
            {notifyEnabled && (
              <div className="flex flex-col gap-2">
                <input
                  className={INPUT_CLASSES}
                  placeholder="Título (ej. Riego completado)"
                  value={notifyTitle}
                  onChange={(event) => setNotifyTitle(event.target.value)}
                />
                <input
                  className={INPUT_CLASSES}
                  placeholder="Mensaje (ej. Se regó el jardín sin problemas)"
                  value={notifyBody}
                  onChange={(event) => setNotifyBody(event.target.value)}
                />
              </div>
            )}
          </div>

          {formError && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !gatewayOnline}
            className={`self-start ${PRIMARY_BUTTON_CLASSES}`}
          >
            {submitting ? "Programando..." : "Programar"}
          </button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Jobs programados</h2>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando...
          </p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-ink-faint">No hay automatizaciones programadas todavía.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job, index) => (
              <Reveal
                key={job.id}
                as="li"
                delay={index * 40}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-3/70 px-3 py-2 text-sm transition-all duration-fast hover:translate-x-0.5 hover:bg-surface-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-ink">
                    {job.steps.map((step) => toolLabel(step.capabilityRef)).join(" → ")}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    <span className="flex items-center gap-1">
                      {job.cron ? <Repeat className="h-3 w-3" aria-hidden="true" /> : <Clock className="h-3 w-3" aria-hidden="true" />}
                      {formatSchedule(job)}
                    </span>
                    {job.notification && (
                      <span className="flex items-center gap-1" title={job.notification.body}>
                        <Bell className="h-3 w-3" aria-hidden="true" />
                        {job.notification.title}
                      </span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Cancelar job"
                  title="Cancelar job"
                  onClick={() => handleCancel(job.id)}
                  className="press shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </Reveal>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
