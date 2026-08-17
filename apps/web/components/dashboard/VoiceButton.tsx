"use client";

import { Mic, Loader2 } from "lucide-react";
import type { VoiceInputStatus } from "@/lib/voice/useVoiceInput";

const LABEL: Record<VoiceInputStatus, string> = {
  idle: "Hablar con KAN",
  recording: "Grabando… (click para enviar)",
  transcribing: "Transcribiendo…",
};

/**
 * Control primario de voz (P1, rediseño de interfaz) — círculo grande, no
 * una pill más entre otras: es la acción que más se usa después de
 * escribir, así que domina visualmente sobre "en vivo"/adjuntar imagen
 * (`LiveVoiceButton`/botón de imagen quedan como controles secundarios más
 * chicos al lado). Etiqueta siempre visible como `title`/`aria-label` — el
 * ícono solo no alcanza para lectores de pantalla ni para quien no sabe
 * qué hace el botón a primera vista.
 */
export function VoiceButton({ status, onClick }: { status: VoiceInputStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "transcribing"}
      aria-label={LABEL[status]}
      title={LABEL[status]}
      className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-transform duration-fast active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:active:scale-100"
    >
      {status === "recording" && (
        <>
          <span className="absolute inset-0 animate-ping rounded-full bg-danger/50" aria-hidden="true" />
          <span
            className="absolute -inset-1.5 rounded-full opacity-60"
            style={{ boxShadow: "0 0 0 3px var(--color-danger)" }}
            aria-hidden="true"
          />
        </>
      )}
      <span
        className={`relative flex h-14 w-14 items-center justify-center rounded-full text-white transition-all duration-fast ${
          status === "recording"
            ? "scale-105 bg-danger shadow-lg shadow-danger/40"
            : "bg-gradient-accent glow-accent hover:scale-105 hover:brightness-110"
        }`}
      >
        {status === "transcribing" ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        ) : (
          <Mic className="h-6 w-6" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
