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
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        sharing
          ? "bg-accent/15 text-accent hover:bg-accent/25"
          : "text-ink-faint hover:bg-surface-3 hover:text-ink-muted"
      }`}
    >
      {sharing ? (
        <ScreenShareOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <ScreenShare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{shortLabel}</span>
    </button>
  );
}
