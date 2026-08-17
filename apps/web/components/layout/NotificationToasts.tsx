"use client";

import { useEffect } from "react";
import { Bell, X } from "lucide-react";
import type { JobNotificationToast } from "@/lib/status/useJobNotificationToasts";

const TOAST_DURATION_MS = 8_000;

/**
 * UI de notificaciones proactivas (ADR-037) — montado en TopBar.tsx, que ya
 * está en toda la app: un toast de automatización disparada se ve sin
 * importar en qué pantalla esté el usuario, no solo en el Dashboard.
 */
export function NotificationToasts({
  toasts,
  onDismiss,
}: {
  toasts: JobNotificationToast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 sm:right-4 sm:left-auto sm:items-end">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: JobNotificationToast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="glass glow-accent fade-in pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-line/80 px-4 py-3">
      <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-xs text-ink-faint">{toast.body}</p>}
      </div>
      <button
        type="button"
        aria-label="Cerrar notificación"
        onClick={() => onDismiss(toast.id)}
        className="press shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
