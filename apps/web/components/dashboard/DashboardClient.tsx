"use client";

import { useSyncExternalStore } from "react";
import type { DashboardSummary } from "@kan/core";
import { useSystemStatusContext } from "@/lib/status/SystemStatusProvider";
import { buildGreeting, timeOfDayGreeting } from "@/lib/greeting";
import { useIsClient } from "@/lib/useIsClient";
import { OnboardingWelcome } from "@/components/dashboard/OnboardingWelcome";
import { FirstRunWelcome } from "@/components/dashboard/FirstRunWelcome";
import { KANHome } from "@/components/kan/KANHome";

// localStorage (no sessionStorage, a diferencia de kan-boot-shown): "una vez
// en la vida", tiene que sobrevivir a cerrar la pestaña — mismo criterio que
// kan:accent en theme.ts. `useSyncExternalStore` (no useEffect+setState,
// mismo criterio que useIsClient/ThemeAccentPicker) — evita tanto el
// mismatch de hidratación de leer localStorage recién en un efecto como el
// re-render en cascada que dispara react-hooks/set-state-in-effect.
const WELCOME_SEEN_KEY = "kan:welcome-seen";
let welcomeListeners: Array<() => void> = [];

function subscribeWelcomeSeen(listener: () => void): () => void {
  welcomeListeners.push(listener);
  return () => {
    welcomeListeners = welcomeListeners.filter((l) => l !== listener);
  };
}

// SSR y primer render del cliente: "ya visto" por defecto — evita mostrar
// el gate en el HTML inicial (mismatch imposible), se corrige solo apenas
// React confirma el snapshot real del cliente.
function getWelcomeSeenServerSnapshot(): boolean {
  return true;
}

function getWelcomeSeenClientSnapshot(): boolean {
  try {
    return Boolean(window.localStorage.getItem(WELCOME_SEEN_KEY));
  } catch {
    return true;
  }
}

function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    // Sin storage no se puede recordar — se repetiría en la próxima carga, no es grave.
  }
  welcomeListeners.forEach((listener) => listener());
}

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

  const welcomeSeen = useSyncExternalStore(subscribeWelcomeSeen, getWelcomeSeenClientSnapshot, getWelcomeSeenServerSnapshot);

  if (isNewUser && !welcomeSeen) {
    return <FirstRunWelcome onStart={markWelcomeSeen} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <KANHome
        greeting={buildGreeting(greeting ?? "Hola", displayName)}
        homeContent={isNewUser && <OnboardingWelcome displayName={displayName} />}
      />
    </div>
  );
}
