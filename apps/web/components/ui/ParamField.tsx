import type { JsonSchema } from "@kan/plugin-contract";
import { INPUT_CLASSES } from "@/components/ui/formStyles";

/**
 * Un campo por propiedad de `inputSchema` (subconjunto de JSON Schema que
 * declaran las capabilities, ver @kan/plugin-contract) — nunca un textarea
 * JSON libre como en AutomatizacionesClient: number/integer → input
 * numérico, boolean → checkbox, string con enum → select, string sin enum →
 * texto. Extraído de SecuenciasClient (constructor de secuencias) para
 * reusarlo tal cual en ControlClient (control manual de actuadores) — misma
 * lógica, dos pantallas.
 */
export function ParamField({
  fieldKey,
  schema,
  required,
  value,
  onChange,
}: {
  fieldKey: string;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const fieldLabel = required ? `${fieldKey} *` : fieldKey;

  if (schema.type === "boolean") {
    return (
      <label className="flex items-center gap-1.5 text-sm text-ink-muted">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {fieldLabel}
      </label>
    );
  }

  if (schema.enum && schema.enum.length > 0) {
    return (
      <label className="flex flex-col gap-1 text-xs text-ink-faint">
        {fieldLabel}
        <select className={INPUT_CLASSES} value={value != null ? String(value) : ""} onChange={(event) => onChange(event.target.value)}>
          <option value="">Elegí...</option>
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <label className="flex flex-col gap-1 text-xs text-ink-faint">
        {fieldLabel}
        <input
          type="number"
          className={INPUT_CLASSES}
          value={value != null ? String(value) : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-faint">
      {fieldLabel}
      <input
        type="text"
        className={INPUT_CLASSES}
        value={value != null ? String(value) : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
