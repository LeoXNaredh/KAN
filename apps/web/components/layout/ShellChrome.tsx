"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import type { UserIdentity } from "@kan/core";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { BootSequence } from "@/components/kan/BootSequence";
import { useBrowserEdgeAgent } from "@/lib/edgeAgent/useBrowserEdgeAgent";
import { SystemStatusProvider } from "@/lib/status/SystemStatusProvider";

// sessionStorage (no localStorage): el boot es "por sesión de browser", no
// "una vez en la vida" — reabrir KAN mañana en una pestaña nueva vuelve a
// mostrarlo, cerrar y volver a abrir la MISMA pestaña no.
const BOOT_SESSION_KEY = "kan-boot-shown";

// React tira un warning en consola si `useLayoutEffect` se ejecuta durante
// el render del lado del servidor (nunca ocurre en el navegador real, pero
// Next.js sí renderiza este componente "use client" server-side para el
// HTML inicial) — este fallback a `useEffect` en el servidor lo evita, sin
// cambiar nada del comportamiento en el cliente (mismo criterio "sin ruido
// en consola a propósito" que useSpeechSynthesis.ts, ADR-014).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function ShellChrome({ user, children }: { user: UserIdentity | undefined; children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [booting, setBooting] = useState(false);
  const [panelsRevealed, setPanelsRevealed] = useState(true);
  // Simulador corriendo en el propio tab (docs/19 continuación) — sobrevive
  // a la navegación client-side dentro del shell porque ShellChrome no se
  // desmonta al cambiar de ruta, solo `children`.
  useBrowserEdgeAgent(Boolean(user));

  // `useLayoutEffect` (no `useEffect`): decide si mostrar el boot ANTES del
  // primer paint del browser, para que no haya un frame de "UI real visible"
  // seguido de un flash del overlay tapándola — el estado inicial (`booting:
  // false`) es el mismo en servidor y cliente (sin sessionStorage en SSR),
  // así que esto no es un mismatch de hidratación, es un re-render normal
  // que React aplica antes de pintar.
  useIsomorphicLayoutEffect(() => {
    try {
      if (!window.sessionStorage.getItem(BOOT_SESSION_KEY)) {
        setBooting(true);
        setPanelsRevealed(false);
      }
    } catch {
      // sessionStorage inaccesible (modo privado estricto, etc.) — sin boot, la app funciona igual.
    }
  }, []);

  const handleBootPanelsReveal = useCallback(() => setPanelsRevealed(true), []);
  const handleBootDone = useCallback(() => {
    setBooting(false);
    try {
      window.sessionStorage.setItem(BOOT_SESSION_KEY, "1");
    } catch {
      // Sin storage no se puede recordar — se repetiría en la próxima carga, no es grave.
    }
  }, []);

  return (
    <SystemStatusProvider>
      <div className="flex min-h-screen w-full bg-surface text-ink">
        <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} entering={!panelsRevealed} />
        <div
          className={`flex min-w-0 flex-1 flex-col transition-all duration-slow delay-150 ${
            panelsRevealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        >
          <TopBar onOpenMenu={() => setMobileNavOpen(true)} user={user} />
          <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
        </div>
        {booting && <BootSequence onPanelsReveal={handleBootPanelsReveal} onDone={handleBootDone} />}
      </div>
    </SystemStatusProvider>
  );
}
