"use client";

import { Camera, CameraOff } from "lucide-react";

/**
 * Cámara dentro de una sesión Live activa (ADR-059) — mismo rol que
 * ScreenShareButton (ADR-044 fase 2): no abre/cierra la sesión, solo agrega
 * o quita el pipeline de video sobre un WS que ya está abierto. Deja que el
 * usuario le muestre a KAN el hardware físico y lo relacione con lo que
 * encontró vía discover_io_map.
 */
export function CameraShareButton({ sharing, onClick }: { sharing: boolean; onClick: () => void }) {
  const label = sharing ? "Apagar la cámara" : "Mostrarle a KAN con la cámara";
  const shortLabel = sharing ? "Cortar" : "Cámara";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-fast active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        sharing
          ? "bg-accent/15 text-accent shadow-[0_0_16px_-4px_var(--color-accent)] hover:bg-accent/25"
          : "text-ink-faint hover:bg-surface-3/80 hover:text-ink-muted"
      }`}
    >
      {sharing ? (
        <CameraOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{shortLabel}</span>
    </button>
  );
}
