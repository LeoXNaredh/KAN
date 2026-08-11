"use client";

import { useEffect } from "react";
import type { EdgeAgent } from "@kan/edge-agent-core/browser";
import { createBrowserEdgeAgent, createSimulatorPlugin } from "./composition";

/**
 * Monta el Edge Agent del Simulador en el propio tab del navegador — así el
 * Dashboard puede mostrar "Simulador: Conectado" sin abrir apps/desktop
 * (docs/19 continuación).
 *
 * Guardia contra doble-montaje (React StrictMode en dev llama efecto→cleanup→
 * efecto de nuevo, en el mismo tick): cada corrida del efecto tiene su propio
 * flag `isMounted` local. Si el cleanup de ESA corrida ya se disparó mientras
 * `registerPlugin`/`bootstrap` seguían en vuelo, se apaga el agente recién
 * creado en vez de dejarlo conectar a ciegas. Como el flag es local a cada
 * invocación del efecto (no un contador compartido), la corrida vigente
 * jamás se cancela por culpa de una corrida anterior — solo se apaga a sí
 * misma si a ELLA la desmontaron.
 *
 * Solo tiene sentido para un usuario ya autenticado (sin sesión no hay a
 * quién pedirle el ticket en /api/edge-ticket) — `enabled` lo controla el
 * caller en vez de asumir nada acá.
 */
export function useBrowserEdgeAgent(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    let agent: EdgeAgent | undefined;

    void (async () => {
      const nextAgent = createBrowserEdgeAgent();
      agent = nextAgent;
      if (!isMounted) {
        void nextAgent.shutdown();
        return;
      }

      await agent.registerPlugin(createSimulatorPlugin());
      if (!isMounted) {
        void agent.shutdown();
        return;
      }

      await agent.bootstrap();
      if (!isMounted) {
        // Se desmontó mientras bootstrap() seguía en vuelo (pudo llegar a
        // abrir el WS) — lo cerramos ahora que terminó de arrancar.
        void agent.shutdown();
      }
    })();

    return () => {
      isMounted = false;
      void agent?.shutdown();
    };
  }, [enabled]);
}
