"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type LiveModeContextValue = { isLiveActive: boolean; setLiveActive: (value: boolean) => void };

const LiveModeContext = createContext<LiveModeContextValue | undefined>(undefined);

/**
 * Estado global mínimo de "¿está prendido el modo Live (voz)?" — la sesión
 * real (`useLiveSession`) solo se instancia dentro de `KANHome.tsx` (vía
 * `useConversation`), así que el resto del shell (ej. `DeviceDiscoveryModal`)
 * no tiene forma de saberlo sin esto. Publica un booleano, no mueve la
 * sesión en sí.
 */
export function LiveModeProvider({ children }: { children: ReactNode }) {
  const [isLiveActive, setLiveActive] = useState(false);
  return <LiveModeContext.Provider value={{ isLiveActive, setLiveActive }}>{children}</LiveModeContext.Provider>;
}

export function useLiveModeContext(): LiveModeContextValue {
  const context = useContext(LiveModeContext);
  if (!context) throw new Error("useLiveModeContext() debe usarse dentro de <LiveModeProvider>.");
  return context;
}
