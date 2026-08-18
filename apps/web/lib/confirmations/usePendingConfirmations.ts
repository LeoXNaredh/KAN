"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingConfirmationDTO } from "./types";

// Mismo intervalo que useSystemStatus.ts (docs/17 §3.1) — no hay motivo para
// que la bandeja de confirmaciones sea más agresiva que el resto del
// polling de estado ya compartido en el shell.
const POLL_INTERVAL_MS = 15_000;

/**
 * Bandeja de confirmaciones pendientes (requisito: verlas/aprobarlas fuera
 * del chat que las disparó — ej. una secuencia de una alerta sin
 * conversación activa) — mismo patrón de polling que `useSystemStatus.ts`.
 * Montado una vez en `ShellChrome`/`TopBar` (global, visible en cualquier
 * página), independiente de `useConversation.ts` (que solo conoce las que
 * surgen DENTRO del turno de chat activo).
 */
export function usePendingConfirmations(): {
  confirmations: PendingConfirmationDTO[];
  resolving: boolean;
  resolve: (confirmationId: string, approved: boolean) => Promise<void>;
} {
  const [confirmations, setConfirmations] = useState<PendingConfirmationDTO[]>([]);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(options: { skipIfHidden?: boolean } = {}) {
      // Mismo criterio que useSystemStatus.ts: pestaña en segundo plano se
      // salta el fetch, nunca en la primera carga.
      if (options.skipIfHidden && typeof document !== "undefined" && document.hidden) return;

      try {
        const response = await fetch("/api/confirmations", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { confirmations: PendingConfirmationDTO[] };
        if (!cancelled) setConfirmations(data.confirmations);
      } catch {
        // La UI debe seguir mostrándose aunque el Gateway esté apagado.
      }
    }

    load();
    const interval = setInterval(() => load({ skipIfHidden: true }), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const resolve = useCallback(async (confirmationId: string, approved: boolean) => {
    setResolving(true);
    try {
      await fetch(`/api/confirmations/${encodeURIComponent(confirmationId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
    } finally {
      // Optimista — la saca de la lista ya mismo en vez de esperar el
      // próximo poll de 15s, tanto si se aprobó como si se canceló (ambas
      // la resuelven del lado del Gateway, ver Gateway.resolveConfirmation()).
      setConfirmations((prev) => prev.filter((c) => c.confirmationId !== confirmationId));
      setResolving(false);
    }
  }, []);

  return { confirmations, resolving, resolve };
}
