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
}
