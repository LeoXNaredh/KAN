"use client";

import { useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { KAN_ACCENT_ATTRIBUTE, KAN_ACCENT_PRESETS, KAN_ACCENT_STORAGE_KEY } from "@/lib/kan/theme";

// Store externo mínimo alrededor de localStorage/el atributo del DOM — el
// script inline de app/layout.tsx y este módulo son los únicos dos lugares
// que tocan `data-kan-accent`, así que un pub-sub casero alcanza (sin
// necesidad de un context ni una librería de estado).
let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getServerSnapshot(): string {
  return "emerald";
}

function getClientSnapshot(): string {
  return window.localStorage.getItem(KAN_ACCENT_STORAGE_KEY) ?? "emerald";
}

/**
 * Selector del color de acento de KAN (identidad Kukulkán) — preferencia
 * puramente visual, en localStorage, nunca en Supabase (no es un dato de
 * usuario ni algo que el Gateway/otros clientes necesiten leer). El script
 * inline en app/layout.tsx ya aplicó la preferencia guardada antes de
 * pintar; este componente solo refleja cuál está activa y permite
 * cambiarla en caliente. `useSyncExternalStore` (con notificación real vía
 * el pub-sub de arriba) en vez de `useEffect`+`setState` — mismo criterio
 * que `useIsClient`, evita el mismatch de hidratación de leer localStorage
 * recién en un efecto, y acá además mantiene el swatch activo sincronizado
 * al instante tras un click.
 */
export function ThemeAccentPicker() {
  const active = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  function select(id: string) {
    if (id === "emerald") {
      document.documentElement.removeAttribute(KAN_ACCENT_ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(KAN_ACCENT_ATTRIBUTE, id);
    }
    window.localStorage.setItem(KAN_ACCENT_STORAGE_KEY, id);
    listeners.forEach((listener) => listener());
  }

  return (
    <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Color de acento de KAN">
      {KAN_ACCENT_PRESETS.map((preset) => {
        const isActive = active === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={preset.label}
            onClick={() => select(preset.id)}
            className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              isActive ? "scale-110 border-ink" : "border-transparent hover:scale-105"
            }`}
            style={{ backgroundColor: preset.hex, boxShadow: isActive ? `0 0 16px 2px ${preset.hex}99` : undefined }}
          >
            {isActive && <Check className="h-4 w-4" aria-hidden="true" style={{ color: "#0a0a0a" }} />}
            <span className="sr-only">{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
