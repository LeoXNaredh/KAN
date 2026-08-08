"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { MEMORY_CATEGORIES, type MemoryEntry } from "@kan/core";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { addMemoryAction, removeMemoryAction } from "@/lib/memory/actions";

interface EditingState {
  category: string;
  key: string;
  value: string;
}

/**
 * CRUD manual de memoria en /configuracion (ADR-035) — isla cliente dentro
 * de una página que sigue siendo Server Component (mismo criterio que
 * ConversationPanel.tsx). "Editar" precarga el formulario de alta
 * (`addMemoryAction` ya hace upsert sobre category+key, así que reenviarlo
 * con el mismo par actualiza en vez de duplicar) en vez de agregar un caso
 * de uso nuevo. category/key quedan deshabilitados mientras se edita
 * (renombrarlos crearía un hecho distinto, no se pidió) — viajan igual al
 * server action vía inputs ocultos, porque un campo `disabled` no se manda
 * con el FormData nativo. El `key` del `<form>` fuerza el remount de los
 * campos no controlados al cambiar de hecho editado o volver a "nuevo".
 */
export function MemoryManager({ memories }: { memories: MemoryEntry[] }) {
  const [editing, setEditing] = useState<EditingState | null>(null);

  return (
    <>
      {memories.length === 0 ? (
        <p className="text-sm text-ink-faint">Sin memorias guardadas todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memories.map((memory) => (
            <li
              key={`${memory.category}:${memory.key}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="mr-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-accent uppercase">
                  {memory.category}
                </span>
                <span className="font-medium text-ink">{memory.key}</span>
                <span className="ml-2 text-ink-muted">{String(memory.value)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing({ category: memory.category, key: memory.key, value: String(memory.value) })}
                  aria-label={`Editar memoria ${memory.key}`}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <form action={removeMemoryAction}>
                  <input type="hidden" name="category" value={memory.category} />
                  <input type="hidden" name="key" value={memory.key} />
                  <button
                    type="submit"
                    aria-label={`Eliminar memoria ${memory.key}`}
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

      <form
        key={editing ? `${editing.category}:${editing.key}` : "new"}
        action={addMemoryAction}
        className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row"
      >
        {editing && (
          <>
            <input type="hidden" name="category" value={editing.category} />
            <input type="hidden" name="key" value={editing.key} />
          </>
        )}
        <select
          name="category"
          disabled={Boolean(editing)}
          defaultValue={editing?.category ?? MEMORY_CATEGORIES[0]}
          required
          className={INPUT_CLASSES}
        >
          {MEMORY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <input
          name="key"
          disabled={Boolean(editing)}
          defaultValue={editing?.key ?? ""}
          placeholder="Clave (ej. unidad_temperatura)"
          required
          className={INPUT_CLASSES}
        />
        <input name="value" defaultValue={editing?.value ?? ""} placeholder="Valor (ej. celsius)" required className={INPUT_CLASSES} />
        <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
          {editing ? "Guardar cambios" : "Agregar"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="self-center text-xs text-ink-faint underline hover:text-ink"
          >
            Cancelar
          </button>
        )}
      </form>
    </>
  );
}
