"use client";

import { Menu, LogOut, PanelRight } from "lucide-react";
import type { UserIdentity } from "@kan/core";
import { StatusDot, type StatusLevel } from "@/components/ui/StatusDot";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { useJobNotificationToasts } from "@/lib/status/useJobNotificationToasts";
import { NotificationToasts } from "@/components/layout/NotificationToasts";
import { PendingConfirmationsButton } from "@/components/layout/PendingConfirmationsButton";
import { signOutAction } from "@/lib/auth/actions";
import type { SystemStatusResponse } from "@/lib/status/types";

function overallConnection(status: SystemStatusResponse | null): { level: StatusLevel; label: string } {
  if (!status) return { level: "offline", label: "Verificando…" };
  if (status.gateway === "offline") return { level: "offline", label: "KAN fuera de línea" };
  const anyAgentOnline = status.edgeAgents.some((agent) => agent.status === "online");
  if (!anyAgentOnline) return { level: "warning", label: "Sin dispositivos" };
  return { level: "online", label: "Todo en línea" };
}

/**
 * Barra superior minimalista (rediseño inspirado en Gemini) — sin
 * reloj/fecha (ocupaban espacio sin aportar nada que el sistema operativo
 * no muestre ya) ni el lockup "KAN / Asistente Inteligente" (redundante con
 * el logo del Sidebar). Solo lo esencial: abrir nav en mobile, abrir el
 * InfoPanel, estado de conexión, usuario y logout.
 */
export function TopBar({
  onOpenMenu,
  onOpenInfo,
  user,
}: {
  onOpenMenu: () => void;
  onOpenInfo: () => void;
  user: UserIdentity | undefined;
}) {
  const { status } = useSystemStatusContext();
  const connection = overallConnection(status);
  const { toasts, dismiss } = useJobNotificationToasts(status?.recentActivity ?? []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3">
      <NotificationToasts toasts={toasts} onDismiss={dismiss} />
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir navegación"
        className="press rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="ml-auto flex items-center gap-3">
        {user && <PendingConfirmationsButton />}
        <StatusDot level={connection.level} label={connection.label} />
        <button
          type="button"
          onClick={onOpenInfo}
          aria-label="Abrir panel de información"
          className="press rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <PanelRight className="h-4 w-4" aria-hidden="true" />
        </button>
        {user && (
          <div className="flex items-center gap-2 border-l border-line pl-3">
            <span className="hidden max-w-[160px] truncate text-sm text-ink-muted sm:inline" title={user.email}>
              {user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Cerrar sesión"
                className="press rounded-full p-2 text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
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
