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
           * está bien para el borde derecho, pero igual se ancla dentro de
           * una banda acotada al ancho de la columna de contenido
           * (`md:left-60`, mismo ancho que `Sidebar` — el InfoPanel del
           * rediseño anterior ya no es una columna persistente, así que no
           * hace falta reservarle borde derecho) para no invadir el Sidebar
           * mobile (`z-20`, por debajo de `TopBar`/nav). Escala 0.7 (no
           * 0.38 como en el avatar de 220px de antes) para que el badge
           * final ronde el mismo tamaño en píxeles ahora que el avatar base
           * bajó a 120px. `showLabel={false}`: un label de texto a esta
           * escala se ve amontonado, no legible.
           */}
          <div className="pointer-events-none fixed inset-y-0 right-0 left-0 z-20 md:left-60">
            <div className="fade-in absolute right-6 bottom-28 origin-bottom-right scale-[0.7] sm:right-8 sm:bottom-32">
              <KANAvatar size="lg" activity={activity} showLabel={false} />
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
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pt-16 pb-12 text-center">
          <KANAvatar size="lg" activity={activity} />
          {hint}
          {/* pb-12 extra acá (no solo en el contenedor de arriba): las cards de
              onboarding quedaban tapadas por la barra `sticky` de abajo sin
              este colchón — `sticky` no reserva espacio propio más allá de
              su propia caja, así que el contenido anterior necesita el suyo.
              El colchón es generoso a propósito (no solo unos px) para que
              la tarjeta de onboarding y la barra de abajo se lean como dos
              piezas claramente separadas, no una sola superficie continua —
              ambas usan `.glass` (blur translúcido), así que sin aire de
              sobra entre ellas se pueden percibir como una sola. */}
          {homeContent && <div className="mt-6 w-full max-w-3xl pb-12">{homeContent}</div>}
        </div>
      )}

      {/*
       * `sticky`, no `fixed`: se queda pegada al fondo del viewport visible
       * sin escapar la columna de contenido (a diferencia del avatar de
       * "working", no necesita banda propia). Fondo más sólido que
       * `.glass` (translúcido) a propósito — es la única pieza de este
       * layout que SIEMPRE está ahí en los 3 estados; necesita leerse como
       * una barra de herramientas anclada, no como una tarjeta de contenido
       * más flotando cerca de lo que sea que haya arriba (onboarding, hint,
       * mensajes).
       */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-line bg-surface-2 px-4 py-3 shadow-[0_-12px_24px_-16px_rgba(0,0,0,0.5)] md:-mx-6 md:px-6">
        {bar}
      </div>
    </div>
  );
}
