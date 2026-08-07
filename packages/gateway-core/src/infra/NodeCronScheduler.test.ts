import { describe, expect, it } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import { NodeCronScheduler } from "./NodeCronScheduler";
import { InMemoryScheduledJobStore } from "./InMemoryScheduledJobStore";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";
import type { TaskRequest, TaskResult } from "../domain/entities/GatewayTask";

const DONE: TaskResult = { status: "done" };

function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

function recordingDispatch() {
  const calls: Array<{ taskRequest: TaskRequest; jobId: string }> = [];
  const dispatch = async (taskRequest: TaskRequest, jobId: string) => {
    calls.push({ taskRequest, jobId });
    return DONE;
  };
  return { calls, dispatch };
}

describe("NodeCronScheduler", () => {
  it("schedule() lanza si no hay cron ni runAt", () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    expect(() => scheduler.schedule({ taskRequest: { capabilityRef: "x", input: {} } })).toThrow(
      "necesita 'cron' o 'runAt'",
    );
  });

  it("schedule() lanza si hay cron Y runAt a la vez", () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    expect(() =>
      scheduler.schedule({ taskRequest: { capabilityRef: "x", input: {} }, cron: "* * * * *", runAt: futureIso(1000) }),
    ).toThrow("no puede tener 'cron' y 'runAt'");
  });

  it("schedule() lanza si el cron es inválido", () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    expect(() => scheduler.schedule({ taskRequest: { capabilityRef: "x", input: {} }, cron: "no-es-cron" })).toThrow(
      "Expresión cron inválida",
    );
  });

  it("schedule() lanza si runAt no es una fecha futura", () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    expect(() =>
      scheduler.schedule({ taskRequest: { capabilityRef: "x", input: {} }, runAt: new Date(Date.now() - 1000).toISOString() }),
    ).toThrow("fecha futura");
  });

  it("un job runAt se dispara una vez, con el jobId correcto, y desaparece de list()", async () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    const { calls, dispatch } = recordingDispatch();
    scheduler.start(dispatch);

    const jobId = scheduler.schedule({ taskRequest: { capabilityRef: "laser.cut", input: { depth: 1 } }, runAt: futureIso(150) });
    expect(scheduler.list().map((j) => j.id)).toContain(jobId);

    await sleep(400);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ taskRequest: { capabilityRef: "laser.cut", input: { depth: 1 } }, jobId });
    expect(scheduler.list().map((j) => j.id)).not.toContain(jobId);
  });

  it("un job cron se dispara repetidamente hasta cancel()", async () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    const { calls, dispatch } = recordingDispatch();
    scheduler.start(dispatch);

    const jobId = scheduler.schedule({ taskRequest: { capabilityRef: "ping", input: {} }, cron: "*/1 * * * * *" });

    await sleep(2500);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => call.jobId === jobId)).toBe(true);

    scheduler.cancel(jobId);
    const countAtCancel = calls.length;
    await sleep(1500);
    expect(calls.length).toBe(countAtCancel);
    expect(scheduler.list()).toEqual([]);
  }, 10000);

  it("un job persiste entre instancias del scheduler que comparten store (sobrevive un reinicio)", () => {
    const store = new InMemoryScheduledJobStore();
    const schedulerA = new NodeCronScheduler(store);
    const jobId = schedulerA.schedule({ taskRequest: { capabilityRef: "riego.diario", input: {} }, cron: "0 8 * * *" });

    const schedulerB = new NodeCronScheduler(store);
    expect(schedulerB.list().map((j) => j.id)).toContain(jobId);
  });

  it("al reiniciar, un job runAt que ya venció mientras el Gateway estaba apagado NO se dispara (seguridad física)", async () => {
    const store = new InMemoryScheduledJobStore();
    // Simula un job persistido por una corrida anterior cuyo runAt ya pasó
    // (se guarda directo en el store, sin pasar por schedule(), que rechazaría un runAt pasado).
    const staleJob: ScheduledJob = {
      id: "stale-1",
      taskRequest: { capabilityRef: "printer.start", input: {} },
      runAt: new Date(Date.now() - 60_000).toISOString(),
    };
    store.save(staleJob);

    const scheduler = new NodeCronScheduler(store);
    const { calls, dispatch } = recordingDispatch();
    scheduler.start(dispatch);

    await sleep(100);

    expect(calls).toHaveLength(0);
    expect(scheduler.list()).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  it("stop() detiene los jobs cron activos", async () => {
    const scheduler = new NodeCronScheduler(new InMemoryScheduledJobStore());
    const { calls, dispatch } = recordingDispatch();
    scheduler.start(dispatch);
    scheduler.schedule({ taskRequest: { capabilityRef: "ping", input: {} }, cron: "*/1 * * * * *" });

    await sleep(1200);
    scheduler.stop();
    const countAtStop = calls.length;
    await sleep(1500);
    expect(calls.length).toBe(countAtStop);
  }, 10000);
});
