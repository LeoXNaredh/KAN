"use client";

import { useEffect } from "react";
import { KANAvatar } from "@/components/kan/KANAvatar";

// Deben coincidir con los delays/duraciones de `.kan-boot-*` en globals.css
// — el timing real vive en CSS (declarativo, sin drift entre renders), pero
// JS necesita el mismo número para avisarle a `ShellChrome` cuándo revelar
// los paneles reales / cuándo desmontar este overlay.
const PANELS_REVEAL_MS = 300;
const DONE_MS = 1000;

/**
 * Boot sequence (rediseño inspirado en Gemini) — solo el logo de KAN
 * apareciendo con un fade suave sobre fondo oscuro, ~1s en total. Sin
 * terminal tipeada, sin sonido: las versiones anteriores (eDEX-UI, boot
 * cinematográfico) se sentían "recargadas" para un producto que quiere
 * leerse limpio y profesional. Se muestra una sola vez por sesión de
 * browser — ver `BOOT_SESSION_KEY` en ShellChrome.tsx, que decide si montar
 * este componente o no; acá adentro no se vuelve a chequear sessionStorage.
 *
 * Puramente cosmético sobre lo que ya está cargado: no bloquea ni retrasa
 * ningún fetch real, es un overlay encima de una UI que ya está montada y
 * lista debajo (ver el `entering`/`panelsRevealed` de ShellChrome).
 */
export function BootSequence({ onPanelsReveal, onDone }: { onPanelsReveal: () => void; onDone: () => void }) {
  useEffect(() => {
    const panelsTimer = window.setTimeout(onPanelsReveal, PANELS_REVEAL_MS);
    const doneTimer = window.setTimeout(onDone, DONE_MS);

    return () => {
      window.clearTimeout(panelsTimer);
      window.clearTimeout(doneTimer);
    };
    // Se ejecuta una única vez al montar — onPanelsReveal/onDone son
    // estables (useCallback sin deps en ShellChrome), reiniciar el timeline
    // en cada re-render del padre reproduciría el boot de nuevo a mitad de
    // camino.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="kan-boot-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface"
      aria-hidden="true"
    >
      <div className="kan-boot-avatar">
        <KANAvatar size="lg" activity="idle" />
      </div>
    </div>
  );
}
