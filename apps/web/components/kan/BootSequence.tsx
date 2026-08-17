"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { KANAvatar } from "@/components/kan/KANAvatar";
import { scheduleBootSounds } from "@/lib/kan/bootSounds";

const BOOT_LOG_LINES = [
  "INICIALIZANDO KAN v3.0...",
  "CARGANDO MÓDULOS DE IA...",
  "CONECTANDO CON DISPOSITIVOS...",
  "VERIFICANDO PROTOCOLOS DE SEGURIDAD...",
  "SISTEMA LISTO.",
];

// Deben coincidir con los delays/duraciones de `.kan-boot-*` en globals.css
// — el timing real vive en CSS (declarativo, sin drift entre renders), pero
// JS necesita los mismos números para: (a) agendar los beeps de audio en el
// mismo instante que cada línea se "tipea", y (b) avisarle a `ShellChrome`
// cuándo revelar los paneles reales / cuándo desmontar este overlay.
const LINE_START_MS = 300;
const LINE_STAGGER_MS = 220;
const AVATAR_DELAY_MS = 1550;
const PANELS_REVEAL_MS = 2200;
const DONE_MS = 2900;

/**
 * Boot sequence estilo eDEX-UI (terminal de arranque) — pantalla negra,
 * líneas de log tipeadas una por una en monospace con scanlines CRT sutiles,
 * el texto se disuelve, el avatar de KAN materializa, y el propio overlay se
 * disuelve para revelar la UI real (sidebar + panel + InfoPanel, animados
 * por ShellChrome vía `onPanelsReveal`). Se muestra una sola vez por sesión
 * de browser — ver `BOOT_SESSION_KEY` en ShellChrome.tsx, que decide si
 * montar este componente o no; acá adentro no se vuelve a chequear
 * sessionStorage.
 *
 * Puramente cosmético sobre lo que ya está cargado: no bloquea ni retrasa
 * ningún fetch real, es un overlay encima de una UI que ya está montada y
 * lista debajo (ver el `entering`/`panelsRevealed` de ShellChrome).
 */
export function BootSequence({ onPanelsReveal, onDone }: { onPanelsReveal: () => void; onDone: () => void }) {
  const audioContextRef = useRef<AudioContext | undefined>(undefined);

  useEffect(() => {
    audioContextRef.current = scheduleBootSounds({
      lineDelaysMs: BOOT_LOG_LINES.map((_, index) => LINE_START_MS + index * LINE_STAGGER_MS),
      avatarDelayMs: AVATAR_DELAY_MS,
      panelsRevealDelayMs: PANELS_REVEAL_MS,
    });

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
    <div className="kan-boot-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-black" aria-hidden="true">
      <div className="kan-scanlines" />
      <div className="kan-boot-lines flex w-full max-w-md flex-col gap-1.5 px-6 font-mono text-xs text-accent sm:text-sm">
        {BOOT_LOG_LINES.map((line, index) => (
          <span
            key={line}
            className="kan-boot-line"
            style={
              {
                "--kan-boot-line-width": `${line.length}ch`,
                animationDelay: `${LINE_START_MS + index * LINE_STAGGER_MS}ms`,
              } as CSSProperties
            }
          >
            <span className="text-ink-faint">{">"} </span>
            {line}
          </span>
        ))}
        <span className="kan-boot-cursor text-accent" style={{ animationDelay: `${LINE_START_MS}ms` }}>
          ▮
        </span>
      </div>
      <div className="kan-boot-avatar">
        <KANAvatar size="lg" activity="idle" />
      </div>
    </div>
  );
}
