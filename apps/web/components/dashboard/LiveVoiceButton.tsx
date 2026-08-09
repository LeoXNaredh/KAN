"use client";

import { Radio, Square, Loader2 } from "lucide-react";
import type { LiveSessionStatus } from "@/lib/voice/useLiveSession";

const LABEL: Record<LiveSessionStatus, string> = {
  idle: "Conversación en vivo con KAN",
  connecting: "Conectando…",
  active: "En vivo — click para cortar",
  error: "Error en la sesión — click para reintentar",
};

/**
 * Conversación en tiempo real (ADR-044) — botón distinto del VoiceButton de
 * push-to-talk: un click abre la sesión de voz en vivo, otro click (o el
 * mismo botón, ahora en su estado "active") la cierra.
 */
export function LiveVoiceButton({ status, onClick }: { status: LiveSessionStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "connecting"}
      aria-label={LABEL[status]}
      title={LABEL[status]}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${
        status === "active"
          ? "animate-pulse bg-danger text-white hover:brightness-110"
          : status === "error"
            ? "border border-danger/60 text-danger hover:bg-danger/10"
            : "border border-line text-ink-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {status === "connecting" ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : status === "active" ? (
        <Square className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Radio className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
