"use client";

import { useSyncExternalStore } from "react";
import { Menu, LogOut } from "lucide-react";
import type { UserIdentity } from "@kan/core";
import { StatusDot, type StatusLevel } from "@/components/ui/StatusDot";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { useJobNotificationToasts } from "@/lib/status/useJobNotificationToasts";
import { NotificationToasts } from "@/components/layout/NotificationToasts";
import { signOutAction } from "@/lib/auth/actions";
import type { SystemStatusResponse } from "@/lib/status/types";

// `getSnapshot()` debe devolver el mismo valor entre llamadas hasta que el
// store realmente cambie — React vuelve a llamarlo justo después de
// renderizar para detectar tearing, y si devolviera Date.now() en vivo casi
// siempre difiere por unos milisegundos, forzando un re-render que se repite
// sin fin ("Maximum update depth exceeded"). Por eso el timestamp solo se
// actualiza dentro del propio tick del intervalo, nunca al leerlo.
let cachedNow = Date.now();

function subscribeToClock(callback: () => void) {
  const interval = setInterval(() => {
    cachedNow = Date.now();
    callback();
  }, 1000);
  return () => clearInterval(interval);
}

function getClockSnapshot(): number {
  return cachedNow;
}

function getServerClockSnapshot(): number {
  return 0;
}

/**
 * useSyncExternalStore en vez de useEffect+setState: el reloj es un sistema
 * externo real (no derivable de props/estado), y este hook evita el patrón
 * de "setState síncrono dentro de un efecto" (react-hooks/set-state-in-effect)
 * a la vez que resuelve la discrepancia servidor/cliente sin un flag manual.
 */
function useClock(): Date | null {
  const timestamp = useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);
  return timestamp === 0 ? null : new Date(timestamp);
}

function overallConnection(status: SystemStatusResponse | null): { level: StatusLevel; label: string } {
  if (!status) return { level: "offline", label: "Verificando…" };
  if (status.gateway === "offline") return { level: "offline", label: "Fuera de línea" };
  const anyAgentOnline = status.edgeAgents.some((agent) => agent.status === "online");
  if (!anyAgentOnline) return { level: "warning", label: "Sin dispositivos" };
  return { level: "online", label: "Todo en línea" };
}

export function TopBar({ onOpenMenu, user }: { onOpenMenu: () => void; user: UserIdentity | undefined }) {
  const now = useClock();
  const { status } = useSystemStatusContext();
  const connection = overallConnection(status);
  const { toasts, dismiss } = useJobNotificationToasts(status?.recentActivity ?? []);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface-2/80 px-4 py-3 backdrop-blur">
      <NotificationToasts toasts={toasts} onDismiss={dismiss} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir navegación"
          className="rounded-lg p-2 text-ink-muted hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div>
          <p className="text-sm font-semibold text-ink">KAN</p>
          <p className="text-xs text-ink-faint">Asistente Inteligente</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-sm text-ink-muted tabular-nums">
            {now ? now.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
          </p>
          <p className="text-xs text-ink-faint">
            {now ? now.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : ""}
          </p>
        </div>
        <StatusDot level={connection.level} label={connection.label} />
        {user && (
          <div className="flex items-center gap-2 border-l border-line pl-4">
            <span className="hidden text-sm text-ink-muted sm:inline">{user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Cerrar sesión"
                className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
