"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { useDeviceDiscovery } from "@/lib/status/useDeviceDiscovery";
import { useLiveModeContext } from "@/lib/live/LiveModeContext";
import { useSpeechSynthesis } from "@/lib/voice/useSpeechSynthesis";
import type { DeviceCapabilitiesView } from "@/lib/secuencias/types";
import type { TelemetryPollResult } from "@/lib/sensores/types";

interface FoundSensor {
  ref: string;
  description: string;
  value?: number;
}

interface FoundActuator {
  ref: string;
  description: string;
}

/**
 * Panel automático que se abre solo cuando `useDeviceDiscovery()` detecta un
 * dispositivo nuevo — montado una sola vez en `ShellChrome`, así que
 * interrumpe sin importar en qué ruta del shell esté el usuario. Trae
 * capabilities + valor actual de sensores con el mismo patrón que
 * `SensoresClient.tsx` (GET /api/capabilities + POST /api/telemetry/poll).
 */
export function DeviceDiscoveryModal() {
  const { newDevice, dismiss } = useDeviceDiscovery();
  const { isLiveActive } = useLiveModeContext();
  const { speak } = useSpeechSynthesis();
  const router = useRouter();
  const announcedRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [sensors, setSensors] = useState<FoundSensor[]>([]);
  const [actuators, setActuators] = useState<FoundActuator[]>([]);

  useEffect(() => {
    if (!newDevice) return;
    let cancelled = false;
    announcedRef.current = null;

    async function load() {
      setLoading(true);
      try {
        const capabilitiesRes = await fetch("/api/capabilities", { cache: "no-store" });
        const capabilitiesData = await capabilitiesRes.json();
        const devices: DeviceCapabilitiesView[] = capabilitiesData.devices ?? [];
        const device = devices.find((d) => d.deviceId === newDevice!.deviceId);
        if (cancelled) return;

        const sensorCaps = (device?.capabilities ?? []).filter((c) => c.severity === "read-only");
        const actuatorCaps = (device?.capabilities ?? []).filter((c) => c.severity !== "read-only");
        setActuators(actuatorCaps.map((c) => ({ ref: c.ref, description: c.description })));

        if (sensorCaps.length === 0) {
          setSensors([]);
          return;
        }

        const pollRes = await fetch("/api/telemetry/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refs: sensorCaps.map((c) => c.ref) }),
          cache: "no-store",
        });
        const pollData = await pollRes.json();
        if (cancelled) return;
        const results: TelemetryPollResult[] = pollData.readings ?? [];
        const valueByRef = new Map(results.filter((r) => r.success).map((r) => [r.ref, r.value]));
        setSensors(sensorCaps.map((c) => ({ ref: c.ref, description: c.description, value: valueByRef.get(c.ref) })));
      } catch {
        if (!cancelled) {
          setSensors([]);
          setActuators([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [newDevice]);

  useEffect(() => {
    if (!newDevice || loading || announcedRef.current === newDevice.deviceId || !isLiveActive) return;
    announcedRef.current = newDevice.deviceId;
    speak(
      `Encontré un dispositivo nuevo: ${newDevice.deviceName}, con ${sensors.length} ${sensors.length === 1 ? "sensor" : "sensores"} y ${actuators.length} ${actuators.length === 1 ? "actuador" : "actuadores"}.`,
    );
  }, [newDevice, loading, isLiveActive, sensors.length, actuators.length, speak]);

  if (!newDevice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card padding="lg" className="w-full max-w-lg">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-ink">Dispositivo nuevo detectado</p>
              <p className="text-xs text-ink-faint">{newDevice.deviceName}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={dismiss}
            className="press rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {loading && <p className="text-sm text-ink-faint">Leyendo lo que encontró KAN en la placa…</p>}

        {!loading && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-faint">Sensores ({sensors.length})</p>
              {sensors.length === 0 ? (
                <p className="text-sm text-ink-faint">Ninguno detectado.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sensors.map((sensor) => (
                    <li key={sensor.ref} className="flex items-center justify-between gap-2 text-sm text-ink">
                      <span className="truncate">{sensor.description}</span>
                      <span className="shrink-0 text-ink-faint">{sensor.value !== undefined ? sensor.value : "esperando lectura"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-ink-faint">Actuadores ({actuators.length})</p>
              {actuators.length === 0 ? (
                <p className="text-sm text-ink-faint">Ninguno detectado.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {actuators.map((actuator) => (
                    <li key={actuator.ref} className="truncate text-sm text-ink">
                      {actuator.description}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            router.push(`/dispositivo/${encodeURIComponent(newDevice.deviceId)}`);
            dismiss();
          }}
          className={`mt-4 w-full ${PRIMARY_BUTTON_CLASSES}`}
        >
          Ir al panel de control
        </button>
      </Card>
    </div>
  );
}
