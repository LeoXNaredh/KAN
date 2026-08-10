"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` recién después de que React hidrató en el navegador — `false`
 * durante SSR y en el primer render del cliente (para que coincida con lo
 * que el servidor ya mandó). `useSyncExternalStore` con un subscribe no-op
 * en vez de `useEffect`+`setState` (ver `TopBar.tsx`, mismo criterio): evita
 * el re-render en cascada que dispara `react-hooks/set-state-in-effect` para
 * cualquier valor que dependa del reloj/timezone del navegador (ej. el
 * saludo del Dashboard, `lib/greeting.ts`) y no se pueda calcular igual en
 * el servidor sin arriesgar un mismatch de hidratación.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
