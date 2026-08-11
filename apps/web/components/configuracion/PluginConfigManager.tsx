"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { setPluginConfigAction } from "@/lib/pluginConfig/actions";
import { PLUGIN_CONFIG_SCHEMA, type PluginConfigField } from "@/lib/pluginConfig/schema";

/**
 * Config de los 15 plugins de hardware, editable desde /configuracion sin
 * tocar `.env.local` a mano — antes esta sección terminaba en un
 * `PlaceholderPage` literal. Un componente genérico (no 15 formularios
 * distintos): cada campo de `PLUGIN_CONFIG_SCHEMA` sabe si es una lista de
 * conexiones (`KAN_SSH_HOSTS`, editable fila por fila, mismo patrón que
 * `MemoryManager`) o un valor único (`KAN_ESP32_PORT`). El server action
 * (`setPluginConfigAction`) guarda el mismo string que el plugin real ya
 * sabe parsear — sin reinterpretar el formato acá.
 */
export function PluginConfigManager({ values }: { values: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-4">
      {PLUGIN_CONFIG_SCHEMA.map((plugin) => (
        <Card key={plugin.pluginId} className="fade-in flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-medium text-ink">{plugin.displayName}</h3>
            <p className="text-xs text-ink-faint">{plugin.description}</p>
          </div>
          {plugin.fields.map((field) => (
            <PluginConfigFieldEditor key={field.envVar} field={field} value={values[field.envVar] ?? ""} />
          ))}
        </Card>
      ))}
    </div>
  );
}

function PluginConfigFieldEditor({ field, value }: { field: PluginConfigField; value: string }) {
  if (field.type === "scalar") return <ScalarField field={field} value={value} />;
  return <ListField field={field} value={value} />;
}

function ScalarField({ field, value }: { field: PluginConfigField; value: string }) {
  return (
    <form action={setPluginConfigAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="envVar" value={field.envVar} />
      <label className="text-xs text-ink-faint">{field.label}</label>
      <div className="flex gap-2">
        <input name="value" defaultValue={value} placeholder={field.example} className={`flex-1 font-mono text-xs ${INPUT_CLASSES}`} />
        <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
          Guardar
        </button>
      </div>
    </form>
  );
}

/**
 * Cada fila es una conexión — un string opaco (`nombre|host|...`) en el
 * mismo formato que el plugin real ya parsea. Editar/eliminar reenvía la
 * lista completa unida con coma, mismo criterio de "reenviar el estado
 * completo" que ya usa `MemoryManager` para editar (upsert).
 */
function ListField({ field, value }: { field: PluginConfigField; value: string }) {
  const entries = value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  function joinedWithout(index: number): string {
    return entries.filter((_, i) => i !== index).join(",");
  }

  function joinedWith(newEntry: string): string {
    const next = [...entries];
    if (editingIndex !== null) next[editingIndex] = newEntry;
    else next.push(newEntry);
    return next.join(",");
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-faint">{field.label}</span>

      {entries.length === 0 ? (
        <p className="text-xs text-ink-faint">Sin conexiones configuradas.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry, index) => (
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-3/70 px-3 py-1.5 text-sm transition-colors hover:bg-surface-3"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{entry}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingIndex(index);
                    setDraft(entry);
                  }}
                  aria-label={`Editar ${entry}`}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <form action={setPluginConfigAction}>
                  <input type="hidden" name="envVar" value={field.envVar} />
                  <input type="hidden" name="value" value={joinedWithout(index)} />
                  <button
                    type="submit"
                    aria-label={`Eliminar ${entry}`}
                    className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={setPluginConfigAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="envVar" value={field.envVar} />
        <input type="hidden" name="value" value={joinedWith(draft)} />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={field.example}
          className={`flex-1 font-mono text-xs ${INPUT_CLASSES}`}
        />
        <button type="submit" className={`self-start ${PRIMARY_BUTTON_CLASSES}`} disabled={!draft.trim()}>
          {editingIndex !== null ? "Guardar cambios" : "Agregar"}
        </button>
        {editingIndex !== null && (
          <button
            type="button"
            onClick={() => {
              setEditingIndex(null);
              setDraft("");
            }}
            className="self-center text-xs text-ink-faint underline hover:text-ink"
          >
            Cancelar
          </button>
        )}
      </form>
    </div>
  );
}
