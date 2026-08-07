import { NextResponse } from "next/server";
import type { ToolDescriptor } from "@kan/plugin-contract";
import type { ActivityEntry, SystemStatusResponse, EdgeAgentStatus } from "@/lib/status/types";
import packageJson from "../../../package.json";

const GATEWAY_URL = process.env.KAN_GATEWAY_URL ?? "http://localhost:8787";
const GATEWAY_TOKEN = process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";
const STATUS_TIMEOUT_MS = 3_000;
const RECENT_ACTIVITY_LIMIT = 10;

interface RawAgentRecord {
  edgeAgentId: string;
  status: "online" | "offline";
  os?: string;
  lastSeenAt: string;
  devices: Array<{ id: string; name: string; kind: string }>;
  installedPlugins: Array<{ id: string; displayName: string }>;
}

interface RawAuditEntry {
  id: string;
  at: string;
  actor: "llm" | "user" | "system";
  action: string;
  subject: string;
  metadata: Record<string, unknown>;
}

/**
 * Traduce una entrada cruda del Audit Service (docs/12 §9) a texto legible
 * para el Dashboard — misma regla del BFF: el cliente nunca ve `action`
 * crudo. Solo traduce las acciones que el Gateway realmente emite hoy
 * (`tool.execute`, `safety_policy.changed`, `job.fired`, `job.notification`
 * (P6/ADR-021) — ver ToolExecutor.ts/Gateway.ts); cualquier acción futura
 * cae al genérico en vez de romper el widget.
 */
function translateAuditEntry(entry: RawAuditEntry): string {
  switch (entry.action) {
    case "tool.execute":
      return `Se ejecutó "${entry.subject}"`;
    case "safety_policy.changed":
      return `Cambió la política de seguridad de ${entry.subject}`;
    case "job.fired":
      return `Se disparó el job programado "${entry.subject}"`;
    case "job.notification":
      return `Notificación de automatización: "${entry.subject}"`;
    default:
      return `${entry.action}: ${entry.subject}`;
  }
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
  const [agentsBody, toolsBody, auditBody] = await Promise.all([
    fetchGateway<{ agents: RawAgentRecord[] }>("/v1/agents"),
    fetchGateway<{ tools: ToolDescriptor[] }>("/v1/tools"),
    fetchGateway<{ entries: RawAuditEntry[] }>("/v1/audit"),
  ]);

  const edgeAgents: EdgeAgentStatus[] = (agentsBody?.agents ?? []).map((agent) => ({
    id: agent.edgeAgentId,
    status: agent.status,
    os: agent.os,
    lastSeenAt: agent.lastSeenAt,
    devices: agent.devices,
    installedPlugins: agent.installedPlugins,
  }));

  const recentActivity: ActivityEntry[] = (auditBody?.entries ?? [])
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((entry) => ({ id: entry.id, at: entry.at, label: translateAuditEntry(entry) }));

  const body: SystemStatusResponse = {
    gateway: agentsBody ? "online" : "offline",
    ai: process.env.GEMINI_API_KEY ? "configured" : "not-configured",
    edgeAgents,
    capabilitiesCount: toolsBody?.tools.length ?? 0,
    version: packageJson.version,
    recentActivity,
  };

  return NextResponse.json(body);
}
