import { NextResponse } from "next/server";
import type { ToolDescriptor } from "@kan/plugin-contract";
import { gatewayFetch } from "@/lib/gateway/gatewayFetch";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";
import { translateAuditEntry, type RawAuditEntry } from "@/lib/status/translateAuditEntry";
import type { ActivityEntry, SystemStatusResponse, EdgeAgentStatus } from "@/lib/status/types";
import packageJson from "../../../package.json";

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

/**
 * (ADR-037) `Gateway.ts` graba `metadata.body` en la misma fila que dispara
 * `notificationService.notify()` (nunca leído en el navegador, ver ADR-037)
 * — esta fila de auditoría es el canal real que sí llega acá.
 */
function toNotification(entry: RawAuditEntry): { title: string; body: string } | undefined {
  if (entry.action !== "job.notification") return undefined;
  const body = entry.metadata.body;
  return { title: entry.subject, body: typeof body === "string" ? body : "" };
}

async function fetchGateway<T>(path: string, userToken?: string): Promise<T | undefined> {
  try {
    const response = await gatewayFetch(
      path,
      { headers: userToken ? { "X-User-Token": userToken } : {} },
      STATUS_TIMEOUT_MS,
    );
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
export async function GET(request: Request) {
  const userToken = await resolveUserToken(request);
  const [agentsBody, toolsBody, auditBody, jobsBody] = await Promise.all([
    fetchGateway<{ agents: RawAgentRecord[] }>("/v1/agents", userToken),
    fetchGateway<{ tools: ToolDescriptor[] }>("/v1/tools", userToken),
    fetchGateway<{ entries: RawAuditEntry[] }>("/v1/audit", userToken),
    fetchGateway<{ jobs: unknown[] }>("/v1/jobs", userToken),
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
    .map((entry) => ({
      id: entry.id,
      at: entry.at,
      label: translateAuditEntry(entry),
      notification: toNotification(entry),
    }));

  const body: SystemStatusResponse = {
    gateway: agentsBody ? "online" : "offline",
    ai: process.env.GEMINI_API_KEY ? "configured" : "not-configured",
    edgeAgents,
    capabilitiesCount: toolsBody?.tools.length ?? 0,
    version: packageJson.version,
    recentActivity,
    jobsCount: jobsBody?.jobs.length ?? 0,
  };

  return NextResponse.json(body);
}
