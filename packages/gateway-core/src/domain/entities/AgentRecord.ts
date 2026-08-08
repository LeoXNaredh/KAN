import type { PluginManifest } from "@kan/plugin-contract";

export type AgentStatus = "online" | "offline";

export interface AgentDeviceSnapshot {
  id: string;
  name: string;
  kind: string;
}

export interface AgentRecord {
  edgeAgentId: string;
  status: AgentStatus;
  protocolVersion: string;
  os?: string;
  agentVersion?: string;
  installedPlugins: PluginManifest[];
  devices: AgentDeviceSnapshot[];
  lastSeenAt: string;
  /** Usuario dueño de este Edge Agent, resuelto vía pairing (docs/19 P2, incremento 3) — `undefined` si todavía no está vinculado. */
  ownerId?: string;
}
