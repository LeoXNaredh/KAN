"use client";

import type { ReactNode } from "react";
import { KANAvatar } from "@/components/kan/KANAvatar";
import type { KANActivity, KANPhase } from "@/lib/kan/useKANState";

/**
 * Shell de los 3 estados del rediseño de identidad KAN (Kukulkán):
 *
 * - "home" — el avatar centrado en el FLUJO NORMAL del documento (no
 *   `fixed`/`absolute` sobre coordenadas del viewport) — la única forma de
 *   garantizar que nunca se superponga con lo que haya arriba (`TopBar`) o
 *   abajo (`homeContent`, ej. `OnboardingWelcome`): el navegador los
 *   apila solo, sin matemática de posición que se desincroniza apenas algo
 *   empuja el layout. `homeContent` (tarjetas de onboarding, etc.) va
 *   DEBAJO del avatar/hint, nunca superpuesto.
 * - "working" — acá sí vale la pena `position: fixed` para el avatar (ya
 *   achicado a la esquina): es un elemento chico que necesita quedarse
 *   visible mientras el panel scrollea, sin competir con contenido dinámico
 *   que lo empuje. `activity` (`thinking`/`speaking`) se refleja en el
 *   mismo avatar — es el estado 2 y 3 del pedido original (KAN trabajando
 *   / respondiendo son la misma posición, solo cambia `activity`).
 *
 * Puramente presentacional — quién decide `phase`/`activity` es
 * `useKANState`, alimentado por `useConversation`; este componente no sabe
 * nada de chat, voz ni streaming.
 */
export function KANLayout({
  phase,
  activity,
  bar,
  panel,
  sideNav,
  hint,
  homeContent,
}: {
  phase: KANPhase;
  activity: KANActivity;
  /** Barra de input — siempre visible, en los 3 estados. */
  bar: ReactNode;
  /** Contenido del panel (mensajes + widgets) — solo se monta en "working". */
  panel: ReactNode;
  /** Navegación lateral minimalista del panel (solo "working", oculta en mobile). */
  sideNav?: ReactNode;
  /** Texto bajo el avatar en "home" (ej. "Habla o escribí con KAN…"). */
  hint?: ReactNode;
  /** Contenido extra de "home", debajo del avatar/hint (ej. onboarding). */
  homeContent?: ReactNode;
}) {
  const working = phase === "working";

  return (
    <div className="relative flex flex-1 flex-col">
      {working ? (
        <>
          {/*
           * Banda de posicionamiento del avatar-esquina — `position: fixed`
           * calcula `right/bottom` contra el viewport completo, lo cual
           * está bien para el borde derecho (el Sidebar solo ocupa la
           * izquierda), pero igual se ancla dentro de una banda acotada al
           * ancho de la columna de contenido (`md:left-60`, mismo ancho que
           * `Sidebar`) por consistencia y para no invadir el Sidebar mobile
           * (`z-20`, por debajo de `TopBar`/nav).
           */}
          <div className="pointer-events-none fixed inset-y-0 right-0 left-0 z-20 md:left-60">
            <div className="fade-in absolute right-6 bottom-28 origin-bottom-right scale-[0.42] sm:right-8 sm:bottom-32">
              <KANAvatar size="lg" activity={activity} />
            </div>
          </div>

          <div className="flex flex-1 gap-4">
            {sideNav && (
              <div className="glass hidden w-14 shrink-0 flex-col items-center gap-1 rounded-2xl border border-line/80 py-3 sm:flex">
                {sideNav}
              </div>
            )}
            {/*
             * "Panel se despliega desde abajo (sheet)" en mobile — mismo
             * componente que en desktop, solo con bordes/esquinas de hoja
             * (rounded-t-3xl, sin borde inferior, -mx-4 para pegar a los
             * bordes de pantalla) por debajo del breakpoint sm.
             */}
            <div className="kan-sheet -mx-4 min-w-0 flex-1 rounded-t-3xl border-t border-line/80 px-4 pt-4 sm:mx-0 sm:rounded-none sm:border-t-0 sm:px-0 sm:pt-0">
              {panel}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
          <KANAvatar size="lg" activity={activity} />
          {hint}
          {homeContent && <div className="mt-4 w-full max-w-3xl">{homeContent}</div>}
        </div>
      )}

      {/* `sticky`, no `fixed`: se queda pegada al fondo del viewport visible sin escapar la columna de contenido (a diferencia del avatar de "working", no necesita banda propia). */}
      <div className="glass sticky bottom-0 z-10 -mx-4 mt-4 border-t border-line/80 px-4 py-3 md:-mx-6 md:px-6">{bar}</div>
    </div>
  );
}
