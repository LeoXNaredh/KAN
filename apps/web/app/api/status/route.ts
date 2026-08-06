import { NextResponse } from "next/server";
import type { ToolDescriptor } from "@kan/plugin-contract";
import type { SystemStatusResponse, EdgeAgentStatus } from "@/lib/status/types";
import packageJson from "../../../package.json";

const GATEWAY_URL = process.env.KAN_GATEWAY_URL ?? "http://localhost:8787";
const GATEWAY_TOKEN = process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";
const STATUS_TIMEOUT_MS = 3_000;

interface RawAgentRecord {
  edgeAgentId: string;
  status: "online" | "offline";
  os?: string;
  lastSeenAt: string;
  devices: Array<{ id: string; name: string; kind: string }>;
  installedPlugins: Array<{ id: string; displayName: string }>;
}

async function fetchGateway<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    // Gateway apagado o inalcanzable: escenario esperado, se degrada sin lanzar.
    return undefined;
  }
}

/**
 * BFF de estado (docs/17 §3.1): traduce lo que el Gateway ya expone
 * (GET /v1/agents, GET /v1/tools) a una forma apta para el Dashboard, para
 * que ningún cliente tenga que combinar ambas por su cuenta. No lanza si el
 * Gateway está apagado — el Dashboard debe verse bien igual.
 */
export async function GET() {
  const [agentsBody, toolsBody] = await Promise.all([
    fetchGateway<{ agents: RawAgentRecord[] }>("/v1/agents"),
    fetchGateway<{ tools: ToolDescriptor[] }>("/v1/tools"),
  ]);

  const edgeAgents: EdgeAgentStatus[] = (agentsBody?.agents ?? []).map((agent) => ({
    id: agent.edgeAgentId,
    status: agent.status,
    os: agent.os,
    lastSeenAt: agent.lastSeenAt,
    devices: agent.devices,
    installedPlugins: agent.installedPlugins,
  }));

  const body: SystemStatusResponse = {
    gateway: agentsBody ? "online" : "offline",
    ai: process.env.GEMINI_API_KEY ? "configured" : "not-configured",
    edgeAgents,
    capabilitiesCount: toolsBody?.tools.length ?? 0,
    version: packageJson.version,
  };

  return NextResponse.json(body);
}
