"use client";

import { useEffect, useState } from "react";
import type { ConversationSummary } from "@kan/core";
import { subscribeToConversationUpdates } from "@/lib/conversations/events";

const POLL_INTERVAL_MS = 15_000;

/**
 * Últimos chats guardados para el sidebar — mismo criterio de polling que
 * useSystemStatus.ts (15s, salteado si la pestaña está en segundo plano):
 * no hay un canal en vivo para "se creó/actualizó una conversación", así que
 * esto es la forma más simple de que el sidebar no quede desactualizado
 * mientras el usuario chatea en `/conversacion` sin navegar.
 */
export function useRecentConversations(
  limit = 5,
): { conversations: ConversationSummary[]; loading: boolean; refresh: () => void } {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Arranca en `true` — sin esto, una lista vacía real ("sin chats
  // todavía") es indistinguible de "la primera carga todavía no volvió",
  // que es justo lo que necesita el skeleton del Sidebar.
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(options: { skipIfHidden?: boolean } = {}) {
      if (options.skipIfHidden && typeof document !== "undefined" && document.hidden) return;
      try {
        const response = await fetch(`/api/conversations?limit=${limit}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { conversations: ConversationSummary[] };
        if (!cancelled) setConversations(data.conversations ?? []);
      } catch {
        // Sin sesión o Supabase caído — el sidebar sigue funcionando sin la lista.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(() => load({ skipIfHidden: true }), POLL_INTERVAL_MS);
    // Refresco inmediato (título en tiempo real) apenas `useConversation`
    // avisa que llegó un mensaje — sin esperar al próximo tick del polling.
    const unsubscribe = subscribeToConversationUpdates(() => load());
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [limit, reloadKey]);

  return { conversations, loading, refresh: () => setReloadKey((key) => key + 1) };
}
