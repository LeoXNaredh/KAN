"use client";

import { useCallback, useEffect, useState } from "react";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import type { CapabilityView, DeviceCapabilitiesView } from "@/lib/secuencias/types";
import type { SensorSummaryView, TelemetryPollResult } from "@/lib/sensores/types";

// Mismo intervalo que /sensores (SensoresClient.tsx) — polling, no
// WebSocket (ADR-009 ya descartó push real-time al browser).
const POLL_INTERVAL_MS = 5_000;

export type DeviceSensor = SensorSummaryView;

export function useDeviceState(deviceId: string): {
  deviceName: string | null;
  connected: boolean;
  sensors: DeviceSensor[];
  actuators: CapabilityView[];
  loading: boolean;
  gatewayOnline: boolean;
  refreshNow: () => void;
} {
  const { status } = useSystemStatusContext();
  const [device, setDevice] = useState<DeviceCapabilitiesView | null>(null);
  const [telemetryByRef, setTelemetryByRef] = useState<Map<string, SensorSummaryView>>(new Map());
  const [loading, setLoading] = useState(true);
  const [gatewayOnline, setGatewayOnline] = useState(true);
  const [forceTick, setForceTick] = useState(0);

  const refreshNow = useCallback(() => setForceTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function tick(options: { skipIfHidden?: boolean } = {}) {
      if (options.skipIfHidden && typeof document !== "undefined" && document.hidden) return;
      try {
        const capabilitiesRes = await fetch("/api/capabilities", { cache: "no-store" });
        const capabilitiesData = await capabilitiesRes.json();
        if (cancelled) return;

        const devices: DeviceCapabilitiesView[] = capabilitiesData.devices ?? [];
        const found = devices.find((d) => d.deviceId === deviceId) ?? null;
        setDevice(found);
        setGatewayOnline(capabilitiesRes.ok);

        const sensorRefs = (found?.capabilities ?? []).filter((c) => c.severity === "read-only").map((c) => c.ref);
        if (sensorRefs.length === 0) {
          setTelemetryByRef(new Map());
          return;
        }

        const [telemetryRes, pollRes] = await Promise.all([
          fetch("/api/telemetry", { cache: "no-store" }),
          fetch("/api/telemetry/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refs: sensorRefs }),
            cache: "no-store",
          }),
        ]);
        const telemetryData = await telemetryRes.json();
        const pollData = await pollRes.json();
        if (cancelled) return;

        const catalog: SensorSummaryView[] = telemetryData.sensors ?? [];
        const pollResults: TelemetryPollResult[] = pollData.readings ?? [];

        const byRef = new Map<string, SensorSummaryView>();
        for (const sensor of catalog) {
          if (sensorRefs.includes(sensor.ref)) byRef.set(sensor.ref, sensor);
        }
        for (const capability of found?.capabilities ?? []) {
          if (capability.severity !== "read-only") continue;
          const existing = byRef.get(capability.ref);
          byRef.set(capability.ref, {
            ref: capability.ref,
            edgeAgentId: found!.edgeAgentId,
            deviceName: found!.deviceName,
            description: capability.description,
            connected: true,
            latest: existing?.latest,
          });
        }
        const now = new Date().toISOString();
        for (const result of pollResults) {
          if (!result.success || result.value === undefined) continue;
          const existing = byRef.get(result.ref);
          if (existing) byRef.set(result.ref, { ...existing, connected: true, latest: { value: result.value, at: now } });
        }

        setTelemetryByRef(byRef);
      } catch {
        if (!cancelled) setGatewayOnline(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    tick();
    const interval = setInterval(() => tick({ skipIfHidden: true }), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // `forceTick` en las deps fuerza un tick inmediato sin esperar el
    // próximo intervalo — usado por refreshNow() después de ejecutar un
    // actuador, para refrescar el sensor relacionado sin los 5s de espera.
  }, [deviceId, forceTick]);

  const actuators = (device?.capabilities ?? []).filter((c) => c.severity !== "read-only");
  const deviceName = device?.deviceName ?? status?.edgeAgents.flatMap((a) => a.devices).find((d) => d.id === deviceId)?.name ?? null;
  const connected = device !== null;

  return { deviceName, connected, sensors: Array.from(telemetryByRef.values()), actuators, loading, gatewayOnline, refreshNow };
}
