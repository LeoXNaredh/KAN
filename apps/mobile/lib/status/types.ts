// Mismo shape que apps/web/lib/status/types.ts (docs/18, incremento 6) —
// /api/status ya devuelve datos traducidos, aptos para el cliente; no hace
// falta ningún cambio de backend para que la app móvil los consuma.
export interface EdgeAgentStatus {
  id: string;
  status: "online" | "offline";
  os?: string;
  lastSeenAt: string;
  devices: Array<{ id: string; name: string; kind: string }>;
  installedPlugins: Array<{ id: string; displayName: string }>;
}

export interface ActivityEntry {
  id: string;
  at: string;
  label: string;
}

export interface SystemStatusResponse {
  gateway: "online" | "offline";
  ai: "configured" | "not-configured";
  edgeAgents: EdgeAgentStatus[];
  capabilitiesCount: number;
  version: string;
  recentActivity: ActivityEntry[];
}
