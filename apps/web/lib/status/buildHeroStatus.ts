import type { SystemStatusResponse } from "./types";

export type HeroLevel = "online" | "warning" | "offline";

export interface HeroStatus {
  level: HeroLevel;
  headline: string;
  detail?: string;
}

/**
 * Colapsa gateway/edgeAgents/ai en una sola frase humana (rediseño de
 * interfaz, VISION_PRODUCT_v0.2.md §4.1): reemplaza la fila de 5
 * `StatusCard` (Core/Gateway/Edge Agent/IA/Estado General) que mostraba
 * infraestructura interna tal cual — el usuario ve un solo estado, con
 * detalle en lenguaje natural solo cuando algo necesita su atención.
 */
export function buildHeroStatus(status: SystemStatusResponse | null): HeroStatus {
  if (!status) return { level: "offline", headline: "Verificando el estado de KAN…" };

  if (status.gateway === "offline") {
    return {
      level: "offline",
      headline: "KAN no está disponible en este momento.",
      detail: "Intentá de nuevo en un rato — ya nos dimos cuenta y lo estamos resolviendo.",
    };
  }

  if (status.edgeAgents.length === 0) {
    return {
      level: "warning",
      headline: "Todavía no conectaste ningún dispositivo.",
      detail: "Vinculá tu primer equipo desde Dispositivos para que KAN pueda actuar sobre el mundo físico.",
    };
  }

  const anyAgentOnline = status.edgeAgents.some((agent) => agent.status === "online");
  if (!anyAgentOnline) {
    return {
      level: "warning",
      headline: "Tus dispositivos están desconectados en este momento.",
      detail: "Revisá que la app de escritorio de KAN esté abierta donde los tenés conectados.",
    };
  }

  if (status.ai !== "configured") {
    return {
      level: "warning",
      headline: "KAN está conectado, pero todavía le falta un detalle de configuración.",
    };
  }

  return { level: "online", headline: "Todo funciona bien." };
}
