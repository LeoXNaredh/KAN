"use client";

import { Radio, Square, Loader2 } from "lucide-react";
import type { LiveSessionStatus } from "@/lib/voice/useLiveSession";

const LABEL: Record<LiveSessionStatus, string> = {
  idle: "Cambiar a conversación en vivo",
  connecting: "Conectando…",
  active: "En vivo — click para cortar",
  error: "Error en la sesión — click para reintentar",
};

const SHORT_LABEL: Record<LiveSessionStatus, string> = {
  idle: "Conversación en vivo",
  connecting: "Conectando…",
  active: "En vivo",
  error: "Reintentar",
};

/**
 * Secundario a propósito (rediseño de interfaz): antes tenía el mismo peso
 * visual que el botón de voz principal (misma pill h-10) — un usuario
 * nuevo no tiene forma de saber cuál probar primero. Ahora es un toggle de
 * texto más chico al lado del control primario (`VoiceButton`), mismo
 * criterio que "modo avanzado" en vez de una alternativa igual de
 * prominente.
 */
export function LiveVoiceButton({ status, onClick }: { status: LiveSessionStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "connecting"}
      aria-label={LABEL[status]}
      title={LABEL[status]}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${
        status === "active"
          ? "bg-danger/15 text-danger"
          : status === "error"
            ? "text-danger hover:bg-danger/10"
            : "text-ink-faint hover:bg-surface-3 hover:text-ink-muted"
      }`}
    >
      {status === "connecting" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      ) : status === "active" ? (
        <Square className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{SHORT_LABEL[status]}</span>
    </button>
  );
}
