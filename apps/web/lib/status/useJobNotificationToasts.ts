"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "./types";

export interface JobNotificationToast {
  id: string;
  title: string;
  body: string;
}

/**
 * Notificaciones proactivas (ADR-037): convierte las entradas de auditoría
 * `job.notification` que ya trae `/api/status` en toasts — el auto-dismiss
 * de cada toast vive en NotificationToasts.tsx (cada item maneja su propio
 * timer), este hook solo decide qué es "nuevo".
 *
 * El primer fetch únicamente siembra los `id` ya vistos, sin generar
 * toasts — evita bombardear con notificaciones de automatizaciones viejas
 * apenas se abre la app. Solo lo que llega en un fetch posterior se muestra.
 */
export function useJobNotificationToasts(recentActivity: ActivityEntry[]): {
  toasts: JobNotificationToast[];
  dismiss: (id: string) => void;
} {
  const seenIds = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<JobNotificationToast[]>([]);

  useEffect(() => {
    if (seenIds.current === null) {
      seenIds.current = new Set(recentActivity.map((entry) => entry.id));
      return;
    }

    const seen = seenIds.current;
    const fresh = recentActivity.filter((entry) => entry.notification && !seen.has(entry.id));
    if (fresh.length === 0) return;

    for (const entry of fresh) seen.add(entry.id);
    setToasts((prev) => [
      ...prev,
      ...fresh.map((entry) => ({ id: entry.id, title: entry.notification!.title, body: entry.notification!.body })),
    ]);
  }, [recentActivity]);

  // Identidad estable (ADR-037): NotificationToasts.tsx la usa como
  // dependencia del timer de auto-dismiss de cada toast — si cambiara en
  // cada render, reiniciaría ese timer sin parar.
  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, dismiss };
}
