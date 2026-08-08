import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  cancelJob,
  createJob,
  formatSchedule,
  listJobs,
  listTools,
  toolLabel,
} from "../../lib/jobs/jobsApi";
import type { ScheduledJobView, ToolSummary } from "../../lib/jobs/types";

const CRON_PRESETS = [
  { label: "Cada hora", value: "0 * * * *" },
  { label: "Cada 5 min", value: "*/5 * * * *" },
  { label: "Diario a las 8:00", value: "0 8 * * *" },
  { label: "Cada lunes 9:00", value: "0 9 * * 1" },
];

interface StepDraft {
  capabilityRef: string;
  inputJson: string;
}

/**
 * Automatizaciones (docs/18, incremento 6) — mismo `/api/jobs`/`/api/tools`
 * que ya usa `AutomatizacionesClient.tsx` en `apps/web`, sin ningún cambio
 * de backend. Sin `<select>` nativo en RN: el picker de capability es una
 * lista desplegable propia chica (tap para expandir, tap en una opción
 * para elegir) en vez de agregar una librería de picker — mismo criterio
 * de "no sumar una dependencia nueva sin necesidad real" ya aplicado con
 * `VoiceButton` (sin librería de iconos). Tampoco hay un date-picker nativo
 * para "una vez": se usa un campo de texto ISO 8601 + botones de atajo
 * ("+1 hora"/"+1 día"), evitando agregar `@react-native-community/
 * datetimepicker` sin poder probar su compatibilidad con el SDK real en
 * este entorno de desarrollo.
 */
export default function AutomatizacionesScreen() {
  const [jobs, setJobs] = useState<ScheduledJobView[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [steps, setSteps] = useState<StepDraft[]>([{ capabilityRef: "", inputJson: "{}" }]);
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);
  const [scheduleType, setScheduleType] = useState<"cron" | "once">("cron");
  const [cron, setCron] = useState("0 * * * *");
  const [runAtText, setRunAtText] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listJobs(), listTools()]).then(([jobsBody, toolsBody]) => {
      if (cancelled) return;
      setJobs(jobsBody.jobs);
      setGatewayOnline(jobsBody.gatewayOnline);
      setTools(toolsBody);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { capabilityRef: "", inputJson: "{}" }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setSteps([{ capabilityRef: "", inputJson: "{}" }]);
    setRunAtText("");
    setNotifyEnabled(false);
    setNotifyTitle("");
    setNotifyBody("");
  }

  async function handleCreate() {
    setFormError(null);

    const parsedSteps: Array<{ capabilityRef: string; input: unknown }> = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.capabilityRef.trim()) {
        setFormError(`Elegí una capability para el paso ${i + 1}.`);
        return;
      }
      try {
        parsedSteps.push({ capabilityRef: step.capabilityRef, input: step.inputJson.trim() ? JSON.parse(step.inputJson) : {} });
      } catch {
        setFormError(`Los argumentos del paso ${i + 1} no son JSON válido.`);
        return;
      }
    }

    if (scheduleType === "once" && !runAtText.trim()) {
      setFormError("Elegí una fecha y hora.");
      return;
    }
    if (notifyEnabled && (!notifyTitle.trim() || !notifyBody.trim())) {
      setFormError("La notificación necesita título y mensaje.");
      return;
    }

    setIsSubmitting(true);
    const result = await createJob({
      steps: parsedSteps,
      notification: notifyEnabled ? { title: notifyTitle.trim(), body: notifyBody.trim() } : undefined,
      cron: scheduleType === "cron" ? cron : undefined,
      runAt: scheduleType === "once" ? new Date(runAtText).toISOString() : undefined,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    resetForm();
    setReloadKey((k) => k + 1);
  }

  function handleCancel(jobId: string) {
    Alert.alert("Cancelar job", "¿Cancelar este job programado?", [
      { text: "No", style: "cancel" },
      {
        text: "Sí, cancelar",
        style: "destructive",
        onPress: async () => {
          await cancelJob(jobId);
          setReloadKey((k) => k + 1);
        },
      },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <Text className="text-lg font-semibold text-ink">Automatización</Text>

      {!gatewayOnline && (
        <Text className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          No se pudo contactar al Gateway. La lista puede estar incompleta y no se pueden crear jobs nuevos.
        </Text>
      )}

      <View className="gap-3 rounded-xl border border-line bg-surface-2 p-3">
        <Text className="text-sm font-medium text-ink-muted">Nuevo job</Text>

        {steps.map((step, index) => (
          <View key={index} className="gap-2 rounded-lg border border-line-strong p-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-ink-faint">Paso {index + 1}</Text>
              {steps.length > 1 && (
                <Pressable onPress={() => removeStep(index)}>
                  <Text className="text-xs text-danger">Quitar</Text>
                </Pressable>
              )}
            </View>

            <Pressable
              disabled={!gatewayOnline}
              onPress={() => setExpandedStepIndex((prev) => (prev === index ? null : index))}
              className="rounded-lg border border-line bg-surface-3 px-3 py-2 disabled:opacity-50"
            >
              <Text className="text-sm text-ink">
                {step.capabilityRef ? toolLabel(tools, step.capabilityRef) : "Elegir capability…"}
              </Text>
            </Pressable>
            {expandedStepIndex === index && (
              <View className="gap-1 rounded-lg border border-line bg-surface-3 p-1">
                {tools.length === 0 ? (
                  <Text className="px-2 py-1 text-xs text-ink-faint">Sin capabilities disponibles.</Text>
                ) : (
                  tools.map((tool) => (
                    <Pressable
                      key={tool.name}
                      onPress={() => {
                        updateStep(index, { capabilityRef: tool.name });
                        setExpandedStepIndex(null);
                      }}
                      className="rounded-md px-2 py-1.5 active:bg-surface-2"
                    >
                      <Text className="text-sm text-ink">{tool.description || tool.name}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}

            <TextInput
              className="rounded-lg border border-line bg-surface-3 px-3 py-2 font-mono text-xs text-ink"
              placeholder="{}"
              placeholderTextColor="#5b6472"
              multiline
              value={step.inputJson}
              onChangeText={(text) => updateStep(index, { inputJson: text })}
            />
          </View>
        ))}
        <Pressable onPress={addStep}>
          <Text className="text-sm text-accent">+ Agregar paso</Text>
        </Pressable>

        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setScheduleType("cron")}
            className={`flex-1 items-center rounded-lg border px-3 py-2 ${scheduleType === "cron" ? "border-accent bg-accent/10" : "border-line"}`}
          >
            <Text className="text-sm text-ink">Recurrente (cron)</Text>
          </Pressable>
          <Pressable
            onPress={() => setScheduleType("once")}
            className={`flex-1 items-center rounded-lg border px-3 py-2 ${scheduleType === "once" ? "border-accent bg-accent/10" : "border-line"}`}
          >
            <Text className="text-sm text-ink">Una sola vez</Text>
          </Pressable>
        </View>

        {scheduleType === "cron" ? (
          <View className="gap-2">
            <TextInput
              className="rounded-lg border border-line bg-surface-3 px-3 py-2 font-mono text-sm text-ink"
              value={cron}
              onChangeText={setCron}
              placeholderTextColor="#5b6472"
            />
            <View className="flex-row flex-wrap gap-2">
              {CRON_PRESETS.map((preset) => (
                <Pressable key={preset.value} onPress={() => setCron(preset.value)} className="rounded-md border border-line px-2 py-1">
                  <Text className="text-xs text-ink-muted">{preset.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <TextInput
              className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink"
              placeholder="Fecha y hora ISO 8601 (ej. 2026-08-10T15:00:00.000Z)"
              placeholderTextColor="#5b6472"
              value={runAtText}
              onChangeText={setRunAtText}
            />
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setRunAtText(new Date(Date.now() + 60 * 60 * 1000).toISOString())}
                className="rounded-md border border-line px-2 py-1"
              >
                <Text className="text-xs text-ink-muted">+1 hora</Text>
              </Pressable>
              <Pressable
                onPress={() => setRunAtText(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}
                className="rounded-md border border-line px-2 py-1"
              >
                <Text className="text-xs text-ink-muted">+1 día</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Pressable
          onPress={() => setNotifyEnabled((prev) => !prev)}
          className="flex-row items-center gap-2"
        >
          <View className={`h-4 w-4 rounded border ${notifyEnabled ? "border-accent bg-accent" : "border-line"}`} />
          <Text className="text-sm text-ink-muted">Enviar una notificación al terminar</Text>
        </Pressable>
        {notifyEnabled && (
          <View className="gap-2">
            <TextInput
              className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink"
              placeholder="Título de la notificación"
              placeholderTextColor="#5b6472"
              value={notifyTitle}
              onChangeText={setNotifyTitle}
            />
            <TextInput
              className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink"
              placeholder="Mensaje"
              placeholderTextColor="#5b6472"
              value={notifyBody}
              onChangeText={setNotifyBody}
            />
          </View>
        )}

        {formError && (
          <Text className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</Text>
        )}

        <Pressable
          disabled={!gatewayOnline || isSubmitting}
          onPress={handleCreate}
          className="items-center rounded-lg bg-accent px-4 py-3 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-sm font-medium text-white">{isSubmitting ? "Creando…" : "Crear job"}</Text>
        </Pressable>
      </View>

      <View className="gap-2 rounded-xl border border-line bg-surface-2 p-3">
        <Text className="text-sm font-medium text-ink-muted">Jobs programados</Text>
        {jobs.length === 0 ? (
          <Text className="text-sm text-ink-faint">Sin automatizaciones todavía.</Text>
        ) : (
          jobs.map((job) => (
            <View key={job.id} className="gap-1 rounded-lg border border-line-strong p-2">
              <Text className="text-sm text-ink">{job.steps.map((step) => toolLabel(tools, step.capabilityRef)).join(" → ")}</Text>
              <Text className="text-xs text-ink-faint">{formatSchedule(job)}</Text>
              {job.notification && (
                <Text className="text-xs text-ink-faint">🔔 {job.notification.title}</Text>
              )}
              <Pressable onPress={() => handleCancel(job.id)}>
                <Text className="text-xs text-danger">Cancelar</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
