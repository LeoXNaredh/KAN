import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { TaskRequest } from "../domain/entities/GatewayTask";
import type { SchedulerPort } from "../domain/ports/SchedulerPort";

const SCHEDULE_JOB_TOOL = "kan_schedule_job";
const CANCEL_JOB_TOOL = "kan_cancel_job";
const LIST_JOBS_TOOL = "kan_list_jobs";

/**
 * Tools de automatizaciones (ADR-039) — mismo patrón que las de memoria
 * (ADR-035) pero un nivel más abajo: declaradas y despachadas acá, dentro
 * de `Gateway.listTools()`/`executeTool()`, antes de llegar a
 * `ToolResolver`/`GlobalCapabilityRegistry` — un job programado no es la
 * capability de un dispositivo, es una operación del propio scheduler.
 */
export const SCHEDULER_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: SCHEDULE_JOB_TOOL,
    description:
      "Programa una automatización: una o varias capabilities ('steps'), ejecutadas en orden, en un horario " +
      "recurrente ('cron') o en una fecha/hora futura única ('runAt') — exactamente uno de los dos. Con " +
      "'notification', avisa cuando termine (haya salido bien o mal).",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              capabilityRef: { type: "string", description: "El nombre exacto de una tool/capability ya disponible." },
              input: { type: "object", description: "Argumentos de esa capability, si necesita alguno." },
            },
            required: ["capabilityRef"],
          },
        },
        cron: { type: "string", description: "Sintaxis node-cron (segundos opcionales), para una automatización recurrente." },
        runAt: { type: "string", description: "Fecha/hora ISO 8601 futura, para una sola ejecución." },
        notification: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: CANCEL_JOB_TOOL,
    description: "Cancela una automatización programada por su id (el que devolvió kan_schedule_job o kan_list_jobs).",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: LIST_JOBS_TOOL,
    description: "Lista las automatizaciones programadas actualmente, con su id, pasos, horario y notificación.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function isSchedulerToolName(name: string): boolean {
  return name === SCHEDULE_JOB_TOOL || name === CANCEL_JOB_TOOL || name === LIST_JOBS_TOOL;
}

function parseSteps(input: unknown): TaskRequest[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const steps: TaskRequest[] = [];
  for (const raw of input) {
    const capabilityRef = (raw as { capabilityRef?: unknown } | null)?.capabilityRef;
    if (typeof capabilityRef !== "string" || !capabilityRef.trim()) return undefined;
    steps.push({ capabilityRef, input: (raw as { input?: unknown }).input ?? {} });
  }
  return steps;
}

function parseNotification(input: unknown): ScheduledJob["notification"] {
  const notification = input as { title?: unknown; body?: unknown } | null | undefined;
  if (!notification) return undefined;
  if (typeof notification.title !== "string" || typeof notification.body !== "string") return undefined;
  return { title: notification.title, body: notification.body };
}

function summarize(job: ScheduledJob) {
  return {
    jobId: job.id,
    steps: job.steps.map((step) => step.capabilityRef),
    cron: job.cron,
    runAt: job.runAt,
    notification: job.notification,
  };
}

export async function executeSchedulerTool(
  scheduler: SchedulerPort,
  name: string,
  args: unknown,
): Promise<ToolExecutionResult> {
  if (name === SCHEDULE_JOB_TOOL) {
    const steps = parseSteps((args as { steps?: unknown } | null)?.steps);
    if (!steps) {
      return { success: false, error: `${SCHEDULE_JOB_TOOL} requiere 'steps': una lista no vacía de { capabilityRef }.` };
    }
    const { cron, runAt } = (args as { cron?: unknown; runAt?: unknown } | null) ?? {};

    try {
      const jobId = scheduler.schedule({
        steps,
        cron: typeof cron === "string" ? cron : undefined,
        runAt: typeof runAt === "string" ? runAt : undefined,
        notification: parseNotification((args as { notification?: unknown } | null)?.notification),
      });
      return { success: true, data: { jobId } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Error desconocido" };
    }
  }

  if (name === CANCEL_JOB_TOOL) {
    const jobId = (args as { jobId?: unknown } | null)?.jobId;
    if (typeof jobId !== "string" || !jobId.trim()) {
      return { success: false, error: `${CANCEL_JOB_TOOL} requiere 'jobId'.` };
    }
    const exists = scheduler.list().some((job) => job.id === jobId);
    if (!exists) {
      return { success: false, error: `No existe ninguna automatización programada con id "${jobId}".` };
    }
    scheduler.cancel(jobId);
    return { success: true, data: { jobId } };
  }

  if (name === LIST_JOBS_TOOL) {
    return { success: true, data: { jobs: scheduler.list().map(summarize) } };
  }

  return { success: false, error: `Tool de automatizaciones desconocida: ${name}` };
}
