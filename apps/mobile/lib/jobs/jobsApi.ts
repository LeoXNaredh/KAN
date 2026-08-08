import type { JobsListResponse, ScheduledJobView, ToolSummary } from "./types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/**
 * `/api/jobs`/`/api/tools` (docs/18, incremento 6) — proxies finos de
 * `apps/web` sobre el Gateway, sin chequeo de sesión (confirmado en la
 * investigación: no leen cookies ni Authorization), así que no hace falta
 * mandar el access_token. Fetch plano, mismo criterio que
 * `useSystemStatus.ts` — JSON simple, sin streaming ni FormData.
 */
export async function listJobs(): Promise<JobsListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/jobs`);
  if (!response.ok) return { jobs: [], gatewayOnline: false };
  return (await response.json()) as JobsListResponse;
}

export async function listTools(): Promise<ToolSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/tools`);
  if (!response.ok) return [];
  const body = (await response.json()) as { tools: ToolSummary[] };
  return body.tools;
}

export interface CreateJobInput {
  steps: Array<{ capabilityRef: string; input: unknown }>;
  notification?: { title: string; body: string };
  cron?: string;
  runAt?: string;
}

export async function createJob(input: CreateJobInput): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error ?? "El Gateway rechazó el job." };
    return { ok: true, jobId: data.jobId };
  } catch {
    return { ok: false, error: "No se pudo contactar al servidor." };
  }
}

export async function cancelJob(jobId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

export function toolLabel(tools: ToolSummary[], ref: string): string {
  return tools.find((tool) => tool.name === ref)?.description ?? ref;
}

export function formatSchedule(job: ScheduledJobView): string {
  if (job.cron) return `Cron: ${job.cron}`;
  if (job.runAt) return `Una vez: ${new Date(job.runAt).toLocaleString()}`;
  return "—";
}
