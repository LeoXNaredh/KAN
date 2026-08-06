"use client";

import { useSyncExternalStore } from "react";
import { StatusDot, type StatusLevel } from "@/components/ui/StatusDot";
import { useSystemStatus } from "@/lib/status/useSystemStatus";

function subscribeToClock(callback: () => void) {
  const interval = setInterval(callback, 1000);
  return () => clearInterval(interval);
}

function getClockSnapshot(): number {
  return Date.now();
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

function overallConnection(
  status: ReturnType<typeof useSystemStatus>["status"],
): { level: StatusLevel; label: string } {
  if (!status) return { level: "offline", label: "Verificando…" };
  if (status.gateway === "offline") return { level: "offline", label: "Fuera de línea" };
  const anyAgentOnline = status.edgeAgents.some((agent) => agent.status === "online");
  if (!anyAgentOnline) return { level: "warning", label: "Sin dispositivos" };
  return { level: "online", label: "Todo en línea" };
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const now = useClock();
  const { status } = useSystemStatus();
  const connection = overallConnection(status);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir navegación"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 md:hidden"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div>
          <p className="text-sm font-semibold text-zinc-100">KAN</p>
          <p className="text-xs text-zinc-500">Asistente Inteligente</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-sm text-zinc-300 tabular-nums">
            {now ? now.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
          </p>
          <p className="text-xs text-zinc-500">
            {now ? now.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : ""}
          </p>
        </div>
        <StatusDot level={connection.level} label={connection.label} />
      </div>
    </header>
  );
}
