"use client";

import { useSyncExternalStore } from "react";

// `getSnapshot()` debe devolver el mismo valor entre llamadas hasta que el
// store realmente cambie — React vuelve a llamarlo justo después de
// renderizar para detectar tearing, y si devolviera Date.now() en vivo casi
// siempre difiere por unos milisegundos, forzando un re-render que se repite
// sin fin ("Maximum update depth exceeded"). Por eso el timestamp solo se
// actualiza dentro del propio tick del intervalo, nunca al leerlo.
let cachedNow = Date.now();

function subscribeToClock(callback: () => void) {
  const interval = setInterval(() => {
    cachedNow = Date.now();
    callback();
  }, 1000);
  return () => clearInterval(interval);
}

function getClockSnapshot(): number {
  return cachedNow;
}

function getServerClockSnapshot(): number {
  return 0;
}

/**
 * useSyncExternalStore en vez de useEffect+setState: el reloj es un sistema
 * externo real (no derivable de props/estado), y este hook evita el patrón
 * de "setState síncrono dentro de un efecto" (react-hooks/set-state-in-effect)
 * a la vez que resuelve la discrepancia servidor/cliente sin un flag manual.
 * Compartido entre TopBar y InfoPanel (rediseño eDEX-UI) — antes vivía
 * duplicado a mano en TopBar.tsx.
 */
export function useClock(): Date | null {
  const timestamp = useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);
  return timestamp === 0 ? null : new Date(timestamp);
}
