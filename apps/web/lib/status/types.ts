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
}

export interface SystemStatusResponse {
  gateway: "online" | "offline";
  ai: "configured" | "not-configured";
  edgeAgents: EdgeAgentStatus[];
  capabilitiesCount: number;
  version: string;
}
