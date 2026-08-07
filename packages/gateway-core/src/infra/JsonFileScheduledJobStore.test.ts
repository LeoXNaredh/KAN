import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileScheduledJobStore } from "./JsonFileScheduledJobStore";
import type { ScheduledJob } from "../domain/entities/ScheduledJob";

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: randomUUID(),
    steps: [{ capabilityRef: "some_capability", input: {} }],
    cron: "0 8 * * *",
    ...overrides,
  };
}

describe("JsonFileScheduledJobStore", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  function tempPath(): string {
    const filePath = join(tmpdir(), `kan-jobs-test-${randomUUID()}.json`);
    tempFiles.push(filePath);
    return filePath;
  }

  it("un archivo inexistente arranca con lista vacía sin lanzar", () => {
    const store = new JsonFileScheduledJobStore(tempPath());
    expect(store.load()).toEqual([]);
  });

  it("save() hace visible el job de inmediato en load()", () => {
    const store = new JsonFileScheduledJobStore(tempPath());
    const j = job();
    store.save(j);
    expect(store.load()).toEqual([j]);
  });

  it("remove() lo quita de load()", () => {
    const store = new JsonFileScheduledJobStore(tempPath());
    const j = job();
    store.save(j);
    store.remove(j.id);
    expect(store.load()).toEqual([]);
  });

  it("persiste a disco — una nueva instancia sobre el mismo archivo recupera los jobs", () => {
    const filePath = tempPath();
    const store = new JsonFileScheduledJobStore(filePath);
    const j = job({ runAt: undefined, cron: "*/5 * * * *" });
    store.save(j);

    const reloaded = new JsonFileScheduledJobStore(filePath);
    expect(reloaded.load()).toEqual([j]);
  });
});
