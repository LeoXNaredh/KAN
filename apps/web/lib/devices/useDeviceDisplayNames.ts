"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Nombres personalizados de dispositivos ("HC-02" -> "Sensor del portón",
 * etc.) — KAN los guarda vía kan_set_memory cuando el usuario le responde en
 * el chat (ver system prompt de SendMessageUseCase y
 * /api/memories/device-names). Se pide una sola vez por sesión de la
 * pantalla, no hace falta polling: renombrar un dispositivo no es algo que
 * pase mientras se está mirando la lista.
 */
export function useDeviceDisplayNames(): (rawName: string) => string {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/memories/device-names", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { names: Record<string, string> };
        if (!cancelled) setNames(data.names ?? {});
      } catch {
        // Sin sesión o Supabase caído — se sigue mostrando el nombre técnico crudo.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useCallback((rawName: string) => names[rawName] ?? rawName, [names]);
}
