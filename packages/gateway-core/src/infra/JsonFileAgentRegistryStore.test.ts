import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileAgentRegistryStore } from "./JsonFileAgentRegistryStore";
import type { AgentRecord } from "../domain/entities/AgentRecord";

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    edgeAgentId: randomUUID(),
    status: "online",
    protocolVersion: "1.0.0",
    installedPlugins: [],
    devices: [],
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("JsonFileAgentRegistryStore", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  function tempPath(): string {
    const filePath = join(tmpdir(), `kan-agents-test-${randomUUID()}.json`);
    tempFiles.push(filePath);
    return filePath;
  }

  it("un archivo inexistente arranca con lista vacía sin lanzar", () => {
    const store = new JsonFileAgentRegistryStore(tempPath());
    expect(store.load()).toEqual([]);
  });

  it("save() hace visible el registro de inmediato en load()", () => {
    const store = new JsonFileAgentRegistryStore(tempPath());
    const r = record();
    store.save(r);
    expect(store.load()).toEqual([r]);
  });

  it("remove() lo quita de load()", () => {
    const store = new JsonFileAgentRegistryStore(tempPath());
    const r = record();
    store.save(r);
    store.remove(r.edgeAgentId);
    expect(store.load()).toEqual([]);
  });

  it("persiste a disco — una nueva instancia sobre el mismo archivo recupera los registros", () => {
    const filePath = tempPath();
    const store = new JsonFileAgentRegistryStore(filePath);
    const r = record({ ownerId: "user-1" });
    store.save(r);

    const reloaded = new JsonFileAgentRegistryStore(filePath);
    expect(reloaded.load()).toEqual([r]);
  });
});
