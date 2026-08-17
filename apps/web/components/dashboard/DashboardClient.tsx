"use client";

import type { DashboardSummary } from "@kan/core";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { buildGreeting, timeOfDayGreeting } from "@/lib/greeting";
import { useIsClient } from "@/lib/useIsClient";
import { OnboardingWelcome } from "@/components/dashboard/OnboardingWelcome";
import { KANHome } from "@/components/kan/KANHome";

/**
 * Pantalla principal ("/") — desde el rediseño eDEX-UI (layout de 3
 * columnas en ShellChrome), el panel central vuelve a ser solo avatar +
 * chat: el estado del sistema, dispositivos, memoria/proyectos, plugins y
 * actividad reciente que antes vivían acá (widgets debajo del chat) pasaron
 * al InfoPanel (columna derecha, siempre visible) para no mostrar la misma
 * información dos veces con estilos distintos. Ver HeroStatus.tsx,
 * SummaryCard.tsx, DeviceCard.tsx, SystemStatus.tsx, ActivityFeed.tsx y
 * PluginCard.tsx — siguen existiendo como componentes reutilizables, solo
 * dejaron de usarse acá.
 */
export function DashboardClient({ summary }: { summary: DashboardSummary | undefined }) {
  const { status, loading } = useSystemStatusContext();

  // Se calcula recién después de hidratar (useIsClient) — evita un mismatch
  // entre la hora del servidor (Vercel, UTC) y la del navegador del
  // usuario. "Hola." es el saludo neutro hasta entonces (ver lib/greeting.ts).
  const isClient = useIsClient();
  const greeting = isClient ? timeOfDayGreeting() : null;

  const hasAnyDevice = (status?.edgeAgents ?? []).some((agent) => agent.devices.length > 0);
  const displayName = summary?.profile.displayName;
  // Recién cuando /api/status ya resolvió al menos una vez (no loading) —
  // sin esto, todo usuario vería la bienvenida guiada un instante mientras
  // sus dispositivos reales todavía están cargando (hasAnyDevice arranca en
  // false para cualquiera, no solo para quien es nuevo de verdad).
  const isNewUser = Boolean(summary) && !loading && summary?.memoriesCount === 0 && !hasAnyDevice;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <KANHome
        greeting={buildGreeting(greeting ?? "Hola", displayName)}
        homeContent={isNewUser && <OnboardingWelcome displayName={displayName} />}
      />
    </div>
  );
}
