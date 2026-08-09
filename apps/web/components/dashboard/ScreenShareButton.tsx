"use client";

import { ScreenShare, ScreenShareOff } from "lucide-react";

/**
 * Compartir pantalla dentro de una sesión Live activa (ADR-044 fase 2) —
 * distinto del LiveVoiceButton: no abre/cierra la sesión, solo agrega o
 * quita el pipeline de video sobre un WS que ya está abierto. Solo tiene
 * sentido mostrarlo cuando hay una sesión Live activa (lo decide quien
 * renderiza este componente).
 */
export function ScreenShareButton({ sharing, onClick }: { sharing: boolean; onClick: () => void }) {
  const label = sharing ? "Dejar de compartir pantalla" : "Compartir pantalla con KAN";
  const shortLabel = sharing ? "Cortar" : "Pantalla";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        sharing
          ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
          : "border-line text-ink-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {sharing ? (
        <ScreenShareOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <ScreenShare className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{shortLabel}</span>
    </button>
  );
}
