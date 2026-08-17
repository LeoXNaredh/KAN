"use client";

import { useEffect, useRef } from "react";
import { KANAvatar } from "@/components/kan/KANAvatar";
import { scheduleBootSounds } from "@/lib/kan/bootSounds";

const LETTERS = ["K", "A", "N"];
const LETTER_DELAY_MS = 140;
// Deben coincidir con los `delaySec`/`animation-delay` usados en
// bootSounds.ts y en las clases .kan-boot-* de globals.css — el timing real
// vive en CSS (declarativo, sin drift entre renders); estas dos constantes
// son los únicos dos momentos en que este componente necesita avisarle al
// padre (ShellChrome) que haga algo.
const PANELS_REVEAL_MS = 1200;
const DONE_MS = 2500;

/**
 * Boot sequence cinematográfico (referencia JARVIS) — pantalla negra con
 * "KAN" apareciendo letra por letra (glitch), el avatar materializándose y
 * palpitando, tonos sintéticos vía Web Audio, y el propio overlay
 * disolviéndose para revelar la UI real (sidebar + contenido, animados por
 * ShellChrome vía `onPanelsReveal`). Se muestra una sola vez por sesión de
 * browser — ver `BOOT_SESSION_KEY` en ShellChrome.tsx, que decide si montar
 * este componente o no; acá adentro no se vuelve a chequear sessionStorage.
 *
 * Puramente cosmético sobre lo que ya está cargado: no bloquea ni retrasa
 * ningún fetch real, es un overlay encima de una UI que ya está montada y
 * lista debajo (ver el `entering`/`panelsRevealed` de ShellChrome).
 */
export function BootSequence({ onPanelsReveal, onDone }: { onPanelsReveal: () => void; onDone: () => void }) {
  const audioContextRef = useRef<AudioContext | undefined>(undefined);

  useEffect(() => {
    audioContextRef.current = scheduleBootSounds();

    const panelsTimer = window.setTimeout(onPanelsReveal, PANELS_REVEAL_MS);
    const doneTimer = window.setTimeout(onDone, DONE_MS);

    return () => {
      window.clearTimeout(panelsTimer);
      window.clearTimeout(doneTimer);
      void audioContextRef.current?.close().catch(() => {});
    };
    // Se ejecuta una única vez al montar — onPanelsReveal/onDone son
    // estables (useCallback sin deps en ShellChrome), reiniciar el timeline
    // en cada re-render del padre reproduciría el boot de nuevo a mitad de
    // camino.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="kan-boot-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-black"
      aria-hidden="true"
    >
      <div className="font-mono text-6xl font-bold tracking-[0.3em] sm:text-7xl">
        {LETTERS.map((letter, index) => (
          <span
            key={letter}
            className="kan-boot-letter text-gradient"
            style={{ animationDelay: `${index * LETTER_DELAY_MS}ms` }}
          >
            {letter}
          </span>
        ))}
      </div>
      <div className="kan-boot-avatar" style={{ animationDelay: "600ms" }}>
        <KANAvatar size="lg" activity="idle" />
      </div>
    </div>
  );
}
