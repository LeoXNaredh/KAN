/**
 * Forma ya traducida a producto del estado del sistema (docs/17 §3.1): el
 * cliente nunca combina /v1/agents + /v1/tools del Gateway por su cuenta —
 * esa traducción vive server-side en app/api/status/route.ts.
 */
export interface EdgeAgentStatus {
  id: string;
  status: "online" | "offline";
  os?: string;
  lastSeenAt: string;
  devices: Array<{ id: string; name: string; kind: string }>;
  installedPlugins: Array<{ id: string; displayName: string }>;
  /** Presente solo si el usuario actual es el dueño real (nunca el de otro) — habilita la UI de compartir acceso (`ShareAccessPanel`). */
  ownerId?: string;
}

/** Entrada de auditoría del Gateway ya traducida a texto legible (P4) — la traducción vive server-side, ver app/api/status/route.ts. */
export interface ActivityEntry {
  id: string;
  at: string;
  label: string;
  /** Presente solo si esta entrada es un `job.notification` (ADR-037) — el resto de la auditoría no la trae. */
  notification?: { title: string; body: string };
}

export interface SystemStatusResponse {
  gateway: "online" | "offline";
  ai: "configured" | "not-configured";
  edgeAgents: EdgeAgentStatus[];
  capabilitiesCount: number;
  version: string;
  recentActivity: ActivityEntry[];
  /** Cantidad de automatizaciones programadas activas (ADR-037) — Dashboard, tarjeta "Automatizaciones". */
  jobsCount: number;
}
