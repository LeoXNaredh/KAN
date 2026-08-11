import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileTaskStore } from "./JsonFileTaskStore";
import type { GatewayTask } from "../domain/entities/GatewayTask";

function task(overrides: Partial<GatewayTask> = {}): GatewayTask {
  return {
    id: randomUUID(),
    capabilityRef: "some_capability",
    status: "dispatched",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("JsonFileTaskStore", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  function tempPath(): string {
    const filePath = join(tmpdir(), `kan-tasks-test-${randomUUID()}.json`);
    tempFiles.push(filePath);
    return filePath;
  }

  it("un archivo inexistente arranca con lista vacía sin lanzar", () => {
    const store = new JsonFileTaskStore(tempPath());
    expect(store.load()).toEqual([]);
  });

  it("save() hace visible la tarea de inmediato en load()", () => {
    const store = new JsonFileTaskStore(tempPath());
    const t = task();
    store.save(t);
    expect(store.load()).toEqual([t]);
  });

  it("remove() la quita de load()", () => {
    const store = new JsonFileTaskStore(tempPath());
    const t = task();
    store.save(t);
    store.remove(t.id);
    expect(store.load()).toEqual([]);
  });

  it("persiste a disco — una nueva instancia sobre el mismo archivo recupera las tareas", () => {
    const filePath = tempPath();
    const store = new JsonFileTaskStore(filePath);
    const t = task({ status: "failed", error: "algo salió mal" });
    store.save(t);

    const reloaded = new JsonFileTaskStore(filePath);
    expect(reloaded.load()).toEqual([t]);
  });
});
