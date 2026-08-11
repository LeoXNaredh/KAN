"use client";

import type { ReactNode } from "react";
import { KANAvatar } from "@/components/kan/KANAvatar";
import type { KANActivity, KANPhase } from "@/lib/kan/useKANState";

/**
 * Shell de los 3 estados del rediseño de identidad KAN (Kukulkán):
 *
 * - "home" — el avatar centrado, grande, con la barra de texto siempre
 *   visible debajo. Pantalla de inicio.
 * - "working" — un solo `KANAvatar` (nunca dos instancias distintas — lo
 *   que se anima es la MISMA caja moviéndose/achicándose vía CSS
 *   `transform`+`inset`, no un mount/unmount de dos avatares) se desliza a
 *   la esquina inferior derecha mientras el panel principal ocupa el
 *   espacio; la actividad (`thinking`/`speaking`) se refleja en el mismo
 *   avatar ya achicado — es el estado 2 y 3 del pedido original (KAN
 *   trabajando / respondiendo son la misma posición, solo cambia
 *   `activity`).
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
}) {
  const working = phase === "working";

  return (
    <div className="relative flex min-h-[calc(100dvh-8rem)] flex-1 flex-col">
      {/*
       * El avatar es SIEMPRE el mismo nodo — el truco de la animación
       * fluida es transicionar `top/left/transform` con CSS, nunca
       * desmontar uno y montar otro. `pointer-events-none` en el wrapper:
       * el avatar es puramente visual, nunca bloquea clicks del panel de
       * atrás cuando está en la esquina.
       */}
      <div
        aria-hidden={working}
        className="pointer-events-none fixed z-30 transition-all duration-slow ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={
          working
            ? { top: "auto", left: "auto", right: "1.5rem", bottom: "7rem", transform: "scale(0.42)" }
            : { top: "32%", left: "50%", right: "auto", bottom: "auto", transform: "translate(-50%, -50%) scale(1)" }
        }
      >
        <KANAvatar size="lg" activity={activity} />
      </div>

      {!working && (
        <div className="flex flex-1 flex-col items-center justify-end gap-3 pb-6 text-center">
          {/* Espaciador: reserva el lugar del avatar (fixed, fuera de flujo) para que `hint` no quede tapado. */}
          <div className="h-40 sm:h-48" aria-hidden="true" />
          {hint}
        </div>
      )}

      {working && (
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
           * bordes de pantalla) por debajo del breakpoint sm. La animación
           * de entrada (.kan-sheet) es la misma en ambos tamaños.
           */}
          <div className="kan-sheet -mx-4 min-w-0 flex-1 rounded-t-3xl border-t border-line/80 px-4 pt-4 sm:mx-0 sm:rounded-none sm:border-t-0 sm:px-0 sm:pt-0">
            {panel}
          </div>
        </div>
      )}

      <div className="mt-4">{bar}</div>
    </div>
  );
}
