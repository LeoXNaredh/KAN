"use client";

import { useEffect, useRef, useState } from "react";
import { useSystemStatusContext } from "./SystemStatusProvider";

export interface DiscoveredDevice {
  edgeAgentId: string;
  deviceId: string;
  deviceName: string;
  kind: string;
}

/**
 * Detecta un dispositivo nuevo comparando la lista de `edgeAgents[].devices`
 * entre polls consecutivos de `useSystemStatusContext()` (ya montado en
 * `ShellChrome`, 15s — ADR-009 descartó push real-time al browser, así que
 * esto reusa el polling existente en vez de agregar un canal nuevo). El
 * primer poll con datos solo puebla el set de "ya vistos" en silencio
 * (baseline): sin esto, cada dispositivo ya conectado antes de abrir la app
 * dispararía el panel apenas carga.
 *
 * El set de "vistos" vive en memoria (useRef, no localStorage) — dura lo que
 * dura la pestaña, que es exactamente lo que pide "sin que el usuario
 * recargue la página".
 */
export function useDeviceDiscovery(): { newDevice: DiscoveredDevice | null; dismiss: () => void } {
  const { status } = useSystemStatusContext();
  const seenRef = useRef<Set<string> | null>(null);
  const [newDevice, setNewDevice] = useState<DiscoveredDevice | null>(null);

  useEffect(() => {
    if (!status) return;

    const current = status.edgeAgents.flatMap((agent) =>
      agent.devices.map((device) => ({
        key: `${agent.id}:${device.id}`,
        edgeAgentId: agent.id,
        deviceId: device.id,
        deviceName: device.name,
        kind: device.kind,
      })),
    );

    if (seenRef.current === null) {
      seenRef.current = new Set(current.map((entry) => entry.key));
      return;
    }

    const unseen = current.find((entry) => !seenRef.current!.has(entry.key));
    if (unseen) {
      seenRef.current.add(unseen.key);
      setNewDevice({ edgeAgentId: unseen.edgeAgentId, deviceId: unseen.deviceId, deviceName: unseen.deviceName, kind: unseen.kind });
    } else {
      for (const entry of current) seenRef.current.add(entry.key);
    }
  }, [status]);

  return { newDevice, dismiss: () => setNewDevice(null) };
}
