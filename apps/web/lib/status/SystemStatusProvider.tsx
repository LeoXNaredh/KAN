"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSystemStatus } from "./useSystemStatus";
import type { SystemStatusResponse } from "./types";

type SystemStatusContextValue = { status: SystemStatusResponse | null; loading: boolean };

const SystemStatusContext = createContext<SystemStatusContextValue | undefined>(undefined);

/**
 * Antes: `TopBar` y `DashboardClient` llamaban `useSystemStatus()` cada uno
 * por su cuenta — dos `fetch("/api/status")` independientes cada 15s
 * (documentado como simplificación deliberada en `useSystemStatus.ts`, "sin
 * dependencias nuevas de manejo de estado"). Un Provider montado una sola
 * vez en `ShellChrome` resuelve el fetch duplicado con lo mismo que ya
 * decía el comentario original: sin dependencia nueva, solo Context de
 * React en vez de que cada consumidor llame al hook por separado.
 */
export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const value = useSystemStatus();
  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>;
}

export function useSystemStatusContext(): SystemStatusContextValue {
  const context = useContext(SystemStatusContext);
  if (!context) throw new Error("useSystemStatusContext() debe usarse dentro de <SystemStatusProvider>.");
  return context;
}
