"use client";

import { Mic, Loader2 } from "lucide-react";
import type { VoiceInputStatus } from "@/lib/voice/useVoiceInput";

const LABEL: Record<VoiceInputStatus, string> = {
  idle: "Hablar con KAN",
  recording: "Grabando… (click para enviar)",
  transcribing: "Transcribiendo…",
};

const SHORT_LABEL: Record<VoiceInputStatus, string> = {
  idle: "Voz",
  recording: "Grabando…",
  transcribing: "Transcribiendo…",
};

/**
 * Control real de voz (P1) — ya no una tarjeta decorativa: vive junto al
 * input del chat en ConversationPanel, el mismo lugar donde vive la
 * conversación real. Etiqueta de texto siempre visible (P2.5) — un ícono
 * solo con `title` no se ve en mobile (sin hover), así que el texto corto
 * vive en el botón, no solo en el tooltip.
 */
export function VoiceButton({ status, onClick }: { status: VoiceInputStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "transcribing"}
      aria-label={LABEL[status]}
      title={LABEL[status]}
      className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${
        status === "recording"
          ? "bg-danger text-white hover:brightness-110"
          : "border border-line text-ink-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {status === "transcribing" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{SHORT_LABEL[status]}</span>
    </button>
  );
}
