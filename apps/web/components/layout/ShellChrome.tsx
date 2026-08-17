"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { LayoutPanelLeft, Radio } from "lucide-react";
import type { DashboardSummary, UserIdentity } from "@kan/core";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { InfoPanel } from "@/components/layout/InfoPanel";
import { BootSequence } from "@/components/kan/BootSequence";
import { ParticleField } from "@/components/kan/ParticleField";
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

export function ShellChrome({
  user,
  summary,
  children,
}: {
  user: UserIdentity | undefined;
  /** Para el InfoPanel (memoria/proyectos) — resuelto una vez en `(shell)/layout.tsx`, mismo caso de uso que ya usaba el Dashboard. */
  summary: DashboardSummary | undefined;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"main" | "info">("main");
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
  // que React aplica antes de pintar. `prefers-reduced-motion`: se salta el
  // teatro completo (la app arranca directo, sin overlay) en vez de mostrarlo
  // igual con animaciones colapsadas a 0.01ms por el `@media` de
  // globals.css — eso dejaría los `setTimeout` de BootSequence esperando ~3s
  // reales frente a una pantalla negra sin nada visible pasando.
  useIsomorphicLayoutEffect(() => {
    try {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduceMotion && !window.sessionStorage.getItem(BOOT_SESSION_KEY)) {
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
      <div className="relative flex min-h-screen w-full bg-surface text-ink">
        <ParticleField />
        <div className="kan-scanlines" />
        <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} entering={!panelsRevealed} />
        <div
          className={`flex min-w-0 flex-1 flex-col transition-all duration-slow delay-150 ${
            panelsRevealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        >
          <TopBar onOpenMenu={() => setMobileNavOpen(true)} user={user} />

          {/* Tabs de mobile/tablet (< xl) — el InfoPanel de 3 columnas no entra ahí, así que se alterna con el contenido normal en vez de apilarlos. */}
          <div className="flex border-b border-line/60 xl:hidden">
            <MobileTabButton active={mobilePane === "main"} onClick={() => setMobilePane("main")} icon={LayoutPanelLeft} label="Panel" />
            <MobileTabButton active={mobilePane === "info"} onClick={() => setMobilePane("info")} icon={Radio} label="Info" />
          </div>

          <main className="flex flex-1 gap-4 p-4 md:p-6">
            <div className={`min-w-0 flex-1 flex-col gap-4 ${mobilePane === "info" ? "hidden xl:flex" : "flex"}`}>{children}</div>
            {/* Columna de escritorio (>= xl) — siempre visible ahí, sin depender del tab de mobile. */}
            <div className="hidden xl:flex">
              <InfoPanel summary={summary} />
            </div>
            {/* Tab de mobile/tablet (< xl) — misma info, instancia separada para no acoplar su visibilidad a la columna de escritorio. */}
            {mobilePane === "info" && (
              <div className="flex flex-1 xl:hidden">
                <InfoPanel summary={summary} mobile />
              </div>
            )}
          </main>
        </div>
        {booting && <BootSequence onPanelsReveal={handleBootPanelsReveal} onDone={handleBootDone} />}
      </div>
    </SystemStatusProvider>
  );
}

function MobileTabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Radio;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors duration-fast ${
        active ? "border-accent text-accent" : "border-transparent text-ink-faint hover:text-ink-muted"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
