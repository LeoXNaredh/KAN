import { describe, expect, it, vi } from "vitest";
import { SCHEDULER_TOOL_DESCRIPTORS, isSchedulerToolName, executeSchedulerTool } from "./schedulerTools";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { SchedulerPort } from "../domain/ports/SchedulerPort";

function fakeScheduler(overrides: Partial<SchedulerPort> = {}): SchedulerPort {
  const jobs: ScheduledJob[] = [];
  return {
    schedule: vi.fn((input) => {
      const id = `job-${jobs.length + 1}`;
      jobs.push({ ...input, id });
      return id;
    }),
    cancel: vi.fn((jobId) => {
      const index = jobs.findIndex((j) => j.id === jobId);
      if (index !== -1) jobs.splice(index, 1);
    }),
    list: vi.fn(() => jobs),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

describe("isSchedulerToolName", () => {
  it("reconoce los tres nombres y ningún otro", () => {
    expect(isSchedulerToolName("kan_schedule_job")).toBe(true);
    expect(isSchedulerToolName("kan_cancel_job")).toBe(true);
    expect(isSchedulerToolName("kan_list_jobs")).toBe(true);
    expect(isSchedulerToolName("kan_set_memory")).toBe(false);
    expect(isSchedulerToolName("c_agent1_led_toggle_led")).toBe(false);
  });
});

describe("SCHEDULER_TOOL_DESCRIPTORS", () => {
  it("declara las tres tools", () => {
    expect(SCHEDULER_TOOL_DESCRIPTORS.map((t) => t.name)).toEqual(["kan_schedule_job", "kan_cancel_job", "kan_list_jobs"]);
  });
});

describe("executeSchedulerTool — kan_schedule_job", () => {
  it("programa un job recurrente y devuelve el jobId", async () => {
    const scheduler = fakeScheduler();

    const result = await executeSchedulerTool(scheduler, "kan_schedule_job", {
      steps: [{ capabilityRef: "c_agent1_led_toggle_led", input: { on: true } }],
      cron: "0 8 * * *",
      notification: { title: "Riego", body: "Se regó el jardín" },
    });

    expect(result).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(scheduler.schedule).toHaveBeenCalledWith({
      steps: [{ capabilityRef: "c_agent1_led_toggle_led", input: { on: true } }],
      cron: "0 8 * * *",
      runAt: undefined,
      notification: { title: "Riego", body: "Se regó el jardín" },
    });
  });

  it("rechaza sin 'steps'", async () => {
    const scheduler = fakeScheduler();

    const result = await executeSchedulerTool(scheduler, "kan_schedule_job", { cron: "0 8 * * *" });

    expect(result.success).toBe(false);
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it("rechaza un step sin capabilityRef", async () => {
    const scheduler = fakeScheduler();

    const result = await executeSchedulerTool(scheduler, "kan_schedule_job", {
      steps: [{ input: {} }],
      runAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("pasa requestingUserId como createdBy del job (P7)", async () => {
    const scheduler = fakeScheduler();

    await executeSchedulerTool(
      scheduler,
      "kan_schedule_job",
      { steps: [{ capabilityRef: "c_x" }], runAt: "2026-01-01T00:00:00.000Z" },
      "user-42",
    );

    expect(scheduler.schedule).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "user-42" }));
  });

  it("propaga como error el mensaje que lanza scheduler.schedule() (ej. cron inválido)", async () => {
    const scheduler = fakeScheduler({
      schedule: vi.fn(() => {
        throw new Error("Expresión cron inválida: no-es-un-cron");
      }),
    });

    const result = await executeSchedulerTool(scheduler, "kan_schedule_job", {
      steps: [{ capabilityRef: "c_x" }],
      cron: "no-es-un-cron",
    });

    expect(result).toEqual({ success: false, error: "Expresión cron inválida: no-es-un-cron" });
  });
});

describe("executeSchedulerTool — kan_cancel_job", () => {
  it("cancela un job existente", async () => {
    const scheduler = fakeScheduler();
    await executeSchedulerTool(scheduler, "kan_schedule_job", {
      steps: [{ capabilityRef: "c_x" }],
      runAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await executeSchedulerTool(scheduler, "kan_cancel_job", { jobId: "job-1" });

    expect(result).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(scheduler.cancel).toHaveBeenCalledWith("job-1");
  });

  it("da error claro si el jobId no existe (en vez del no-op silencioso de cancel())", async () => {
    const scheduler = fakeScheduler();

    const result = await executeSchedulerTool(scheduler, "kan_cancel_job", { jobId: "no-existe" });

    expect(result.success).toBe(false);
    expect(scheduler.cancel).not.toHaveBeenCalled();
  });

  it("rechaza sin 'jobId'", async () => {
    const scheduler = fakeScheduler();

    const result = await executeSchedulerTool(scheduler, "kan_cancel_job", {});

    expect(result.success).toBe(false);
  });
});

describe("executeSchedulerTool — kan_list_jobs", () => {
  it("devuelve los jobs programados resumidos", async () => {
    const scheduler = fakeScheduler();
    await executeSchedulerTool(scheduler, "kan_schedule_job", {
      steps: [{ capabilityRef: "c_x" }],
      cron: "0 8 * * *",
    });

    const result = await executeSchedulerTool(scheduler, "kan_list_jobs", {});

    expect(result).toEqual({
      success: true,
      data: { jobs: [{ jobId: "job-1", steps: ["c_x"], cron: "0 8 * * *", runAt: undefined, notification: undefined }] },
    });
  });
});

describe("executeSchedulerTool — nombre desconocido", () => {
  it("devuelve error en vez de lanzar", async () => {
    const scheduler = fakeScheduler();

    const result = await executeSchedulerTool(scheduler, "kan_otra_cosa", {});

    expect(result).toEqual({ success: false, error: "Tool de automatizaciones desconocida: kan_otra_cosa" });
  });
});
