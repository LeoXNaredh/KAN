import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import RNSlider from "@react-native-community/slider";
import { fetchDevices, resolveConfirmation, runCapability } from "../../lib/control/controlApi";
import type { ActionSeverity, CapabilityView, DeviceCapabilitiesView, JsonSchema } from "../../lib/control/types";

interface ControlResult {
  status: "running" | "done" | "failed";
  error?: string;
}

const SEVERITY_BADGE: Partial<Record<ActionSeverity, { label: string; textClass: string; bgClass: string; borderClass: string }>> = {
  "irreversible-material": { label: "Mueve algo físico", textClass: "text-warning", bgClass: "bg-warning/10", borderClass: "border-warning/50" },
  "safety-critical": { label: "Acción crítica", textClass: "text-danger", bgClass: "bg-danger/10", borderClass: "border-danger/50" },
};

// Mismo texto que describeConfirmationConsequence en @kan/plugin-contract
// (PendingConfirmationModal en apps/web) — espejo local, mismo criterio que
// el resto de lib/control (evita bundlear ese paquete acá).
function describeConfirmationConsequence(severity: ActionSeverity): string {
  if (severity === "safety-critical") {
    return "Esto puede afectar la seguridad del sistema — fijate bien antes de confirmar.";
  }
  return "Esto cambia algo físico real y no se puede deshacer después.";
}

/**
 * Control manual de actuadores (versión mínima) — mismo GET
 * /api/capabilities y POST /api/tools/kan_run_sequence/execute que
 * ControlClient.tsx en apps/web, con `Alert.alert` nativo en vez del modal
 * propio (PendingConfirmationModal es un componente web) para la
 * confirmación de acciones irreversible-material/safety-critical. Sin
 * polling (a diferencia de /sensores): solo escribe, no hace falta
 * refrescar valores en vivo.
 */
export default function ControlScreen() {
  const [devices, setDevices] = useState<DeviceCapabilitiesView[]>([]);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, ControlResult>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await fetchDevices();
      if (cancelled) return;
      setDevices(result.devices);
      setGatewayOnline(result.gatewayOnline);
      setLoading(false);
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

  async function execute(ref: string, capabilityName: string, input: Record<string, unknown>) {
    setResults((prev) => ({ ...prev, [ref]: { status: "running" } }));
    const result = await runCapability(ref, input);

    if (result.type === "confirmation") {
      setResults((prev) => {
        const next = { ...prev };
        delete next[ref];
        return next;
      });
      Alert.alert(
        "¿Confirmás esta acción?",
        `${capabilityName}\n\n${describeConfirmationConsequence(result.severity)}`,
        [
          { text: "Cancelar", style: "cancel", onPress: () => void resolvePending(ref, result.confirmationId, false) },
          { text: "Sí, hacelo", style: "destructive", onPress: () => void resolvePending(ref, result.confirmationId, true) },
        ],
        { cancelable: false },
      );
      return;
    }

    if (result.type === "done") {
      setResults((prev) => ({ ...prev, [ref]: { status: "done" } }));
    } else {
      setResults((prev) => ({ ...prev, [ref]: { status: "failed", error: result.error } }));
    }
  }

  async function resolvePending(ref: string, confirmationId: string, approved: boolean) {
    if (!approved) return;
    const result = await resolveConfirmation(confirmationId, approved);
    setResults((prev) => ({
      ...prev,
      [ref]: result.success ? { status: "done" } : { status: "failed", error: result.error ?? "No se pudo ejecutar." },
    }));
  }

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <Text className="text-lg font-semibold text-ink">Control</Text>

      {!gatewayOnline && !loading && (
        <Text className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          No se pudo contactar al Gateway. No se pueden ver ni accionar dispositivos ahora mismo.
        </Text>
      )}

      {loading && (
        <View className="items-center py-8">
          <ActivityIndicator color="#0ea5e9" />
        </View>
      )}

      {!loading && actionable.length === 0 && (
        <Text className="text-sm text-ink-faint">Ningún actuador disponible todavía.</Text>
      )}

      {actionable.map(({ device, capability }) => {
        const result = results[capability.ref];
        const badge = SEVERITY_BADGE[capability.severity];
        return (
          <View
            key={capability.ref}
            className={`gap-3 rounded-xl border bg-surface-2 p-3 ${badge?.borderClass ?? "border-line"}`}
          >
            <View className="flex-row items-start justify-between gap-2">
              <View className="flex-1">
                <Text className="text-sm font-medium text-ink">{capability.description}</Text>
                <Text className="text-xs text-ink-faint">{device.deviceName}</Text>
              </View>
              {badge && (
                <View className={`shrink-0 rounded-full px-2 py-0.5 ${badge.bgClass}`}>
                  <Text className={`text-[10px] font-medium ${badge.textClass}`}>{badge.label}</Text>
                </View>
              )}
            </View>

            <ActuatorControl
              capability={capability}
              disabled={result?.status === "running"}
              onExecute={(input) => void execute(capability.ref, capability.description, input)}
            />

            {result && (
              <Text
                className={`text-xs ${result.status === "failed" ? "text-danger" : result.status === "done" ? "text-success" : "text-ink-faint"}`}
              >
                {result.status === "running" && "Ejecutando…"}
                {result.status === "done" && "✓ Hecho"}
                {result.status === "failed" && `✗ Falló: ${result.error}`}
              </Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * Decide qué control renderizar según `inputSchema` — mismo criterio que
 * ControlClient.tsx: nunca hooks acá adentro (la cantidad de parámetros
 * cambia entre capabilities), cada rama es un componente separado con sus
 * propios hooks.
 */
function ActuatorControl({
  capability,
  disabled,
  onExecute,
}: {
  capability: CapabilityView;
  disabled: boolean;
  onExecute: (input: Record<string, unknown>) => void;
}) {
  const properties = capability.inputSchema?.properties ?? {};
  const required = capability.inputSchema?.required ?? [];
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <Pressable
        disabled={disabled}
        onPress={() => onExecute({})}
        className="items-center rounded-lg bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
      >
        <Text className="text-sm font-medium text-white">{disabled ? "Ejecutando…" : "Ejecutar"}</Text>
      </Pressable>
    );
  }

  if (keys.length === 1) {
    const fieldKey = keys[0];
    const schema = properties[fieldKey];

    if (schema.type === "boolean") {
      return <ToggleControl fieldKey={fieldKey} disabled={disabled} onExecute={onExecute} />;
    }

    if (schema.type === "number" || schema.type === "integer") {
      const min = schema.minimum;
      const max = schema.maximum;
      if (typeof min === "number" && typeof max === "number") {
        return <SliderControl fieldKey={fieldKey} min={min} max={max} disabled={disabled} onExecute={onExecute} />;
      }
      return <NumberApplyControl fieldKey={fieldKey} disabled={disabled} onExecute={onExecute} />;
    }
  }

  return <MultiParamControl properties={properties} required={required} disabled={disabled} onExecute={onExecute} />;
}

/** Acción discreta (como un interruptor real) — ejecuta apenas se lo toca, sin paso intermedio. */
function ToggleControl({
  fieldKey,
  disabled,
  onExecute,
}: {
  fieldKey: string;
  disabled: boolean;
  onExecute: (input: Record<string, unknown>) => void;
}) {
  const [checked, setChecked] = useState(false);

  function toggle(next: boolean) {
    setChecked(next);
    onExecute({ [fieldKey]: next });
  }

  return (
    <View className="flex-row items-center gap-2">
      <Switch value={checked} onValueChange={toggle} disabled={disabled} />
      <Text className="text-sm text-ink-muted">{checked ? "Encendido" : "Apagado"}</Text>
    </View>
  );
}

/** Ejecuta al soltar (onSlidingComplete), nunca en cada tick del drag — mover un servo/dimmer a cada pixel saturaría el hardware real. */
function SliderControl({
  fieldKey,
  min,
  max,
  disabled,
  onExecute,
}: {
  fieldKey: string;
  min: number;
  max: number;
  disabled: boolean;
  onExecute: (input: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState(min);

  return (
    <View className="gap-1">
      <RNSlider
        minimumValue={min}
        maximumValue={max}
        value={value}
        disabled={disabled}
        onValueChange={setValue}
        onSlidingComplete={(finalValue) => onExecute({ [fieldKey]: finalValue })}
        minimumTrackTintColor="#0ea5e9"
        maximumTrackTintColor="#1f2430"
        thumbTintColor="#0ea5e9"
      />
      <View className="flex-row justify-between">
        <Text className="text-xs text-ink-faint">{min}</Text>
        <Text className="text-xs font-medium text-ink">{Math.round(value)}</Text>
        <Text className="text-xs text-ink-faint">{max}</Text>
      </View>
    </View>
  );
}

/** Sin rango declarado no hay un slider con sentido — número libre + confirmación explícita de "Aplicar". */
function NumberApplyControl({
  fieldKey,
  disabled,
  onExecute,
}: {
  fieldKey: string;
  disabled: boolean;
  onExecute: (input: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        className="w-24 rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink"
        keyboardType="numeric"
        value={value}
        editable={!disabled}
        onChangeText={setValue}
        placeholderTextColor="#5b6472"
      />
      <Pressable
        disabled={disabled || value.trim() === ""}
        onPress={() => onExecute({ [fieldKey]: Number(value) })}
        className="rounded-lg border border-line px-3 py-2 active:opacity-80 disabled:opacity-50"
      >
        <Text className="text-sm text-ink-muted">Aplicar</Text>
      </Pressable>
    </View>
  );
}

/** 2+ parámetros (ej. pin + value): no hay un único "el" valor sin ambigüedad — un TextInput por parámetro. */
function MultiParamControl({
  properties,
  required,
  disabled,
  onExecute,
}: {
  properties: Record<string, JsonSchema>;
  required: string[];
  disabled: boolean;
  onExecute: (input: Record<string, unknown>) => void;
}) {
  const [input, setInput] = useState<Record<string, string>>({});

  function buildInput(): Record<string, unknown> {
    const built: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(properties)) {
      const raw = input[key] ?? "";
      built[key] = schema.type === "number" || schema.type === "integer" ? Number(raw) : raw;
    }
    return built;
  }

  return (
    <View className="gap-2">
      {Object.entries(properties).map(([key, schema]) => (
        <TextInput
          key={key}
          className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink"
          placeholder={required.includes(key) ? `${key} *` : key}
          placeholderTextColor="#5b6472"
          keyboardType={schema.type === "number" || schema.type === "integer" ? "numeric" : "default"}
          value={input[key] ?? ""}
          editable={!disabled}
          onChangeText={(text) => setInput((prev) => ({ ...prev, [key]: text }))}
        />
      ))}
      <Pressable
        disabled={disabled}
        onPress={() => onExecute(buildInput())}
        className="items-center self-start rounded-lg bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
      >
        <Text className="text-sm font-medium text-white">{disabled ? "Ejecutando…" : "Ejecutar"}</Text>
      </Pressable>
    </View>
  );
}
