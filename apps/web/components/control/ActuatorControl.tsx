"use client";

import { useState } from "react";
import type { JsonSchema } from "@kan/plugin-contract";
import { ParamField } from "@/components/ui/ParamField";
import { PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES, INPUT_CLASSES } from "@/components/ui/formStyles";
import type { CapabilityView } from "@/lib/secuencias/types";

/**
 * Extraído de ControlClient.tsx (era un conjunto de funciones de módulo no
 * exportadas) para reusarlo también en DispositivoClient.tsx — mismo
 * comportamiento, sin cambios.
 *
 * Decide qué control renderizar según la forma de `inputSchema` — nunca
 * hooks acá adentro (la cantidad de parámetros cambia entre capabilities,
 * violaría las reglas de hooks): cada rama es un componente separado con
 * sus propios hooks, este solo elige cuál montar.
 */
export function ActuatorControl({
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
      <button type="button" disabled={disabled} onClick={() => onExecute({})} className={PRIMARY_BUTTON_CLASSES}>
        {disabled ? "Ejecutando…" : "Ejecutar"}
      </button>
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

  function toggle() {
    if (disabled) return;
    const next = !checked;
    setChecked(next);
    onExecute({ [fieldKey]: next });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={toggle}
        className={`press flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors duration-fast disabled:opacity-50 ${
          checked ? "bg-accent justify-end" : "bg-surface-3 justify-start"
        }`}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </button>
      <span className="text-sm text-ink-muted">{checked ? "Encendido" : "Apagado"}</span>
    </div>
  );
}

/**
 * Ejecuta al soltar (`onPointerUp`/`onKeyUp`), nunca en cada tick del
 * drag/flecha — mover un servo o un dimmer a cada pixel arrastrado
 * saturaría el hardware real con docenas de ejecuciones por segundo.
 */
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

  function commit() {
    if (!disabled) onExecute({ [fieldKey]: value });
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className="w-full accent-accent"
      />
      <div className="flex justify-between text-xs text-ink-faint">
        <span>{min}</span>
        <span className="font-medium text-ink">{value}</span>
        <span>{max}</span>
      </div>
    </div>
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
    <div className="flex items-center gap-2">
      <input
        type="number"
        className={`w-24 ${INPUT_CLASSES}`}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="button"
        disabled={disabled || value.trim() === ""}
        onClick={() => onExecute({ [fieldKey]: Number(value) })}
        className={SECONDARY_BUTTON_CLASSES}
      >
        Aplicar
      </button>
    </div>
  );
}

/** 2+ parámetros (ej. pin + value): no hay un único "el" valor sin ambigüedad — mismo formulario genérico que SecuenciasClient. */
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
  const [input, setInput] = useState<Record<string, unknown>>({});

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(properties).map(([key, schema]) => (
          <ParamField
            key={key}
            fieldKey={key}
            schema={schema}
            required={required.includes(key)}
            value={input[key]}
            onChange={(value) => setInput((prev) => ({ ...prev, [key]: value }))}
          />
        ))}
      </div>
      <button type="button" disabled={disabled} onClick={() => onExecute(input)} className={`self-start ${PRIMARY_BUTTON_CLASSES}`}>
        {disabled ? "Ejecutando…" : "Ejecutar"}
      </button>
    </div>
  );
}
