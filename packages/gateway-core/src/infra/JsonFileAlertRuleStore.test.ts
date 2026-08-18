import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileAlertRuleStore } from "./JsonFileAlertRuleStore";
import type { AlertRule } from "../domain/entities/AlertRule";

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: randomUUID(),
    capabilityRef: "c_agent1_simulator1_read_sensor",
    field: "temperatureC",
    comparator: "above",
    threshold: 40,
    label: "la temperatura",
    unit: "grados",
    createdAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("JsonFileAlertRuleStore", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  function tempPath(): string {
    const filePath = join(tmpdir(), `kan-alerts-test-${randomUUID()}.json`);
    tempFiles.push(filePath);
    return filePath;
  }

  it("un archivo inexistente arranca con lista vacía sin lanzar", () => {
    const store = new JsonFileAlertRuleStore(tempPath());
    expect(store.load()).toEqual([]);
  });

  it("save() hace visible la alerta de inmediato en load()", () => {
    const store = new JsonFileAlertRuleStore(tempPath());
    const r = rule();
    store.save(r);
    expect(store.load()).toEqual([r]);
  });

  it("remove() la quita de load()", () => {
    const store = new JsonFileAlertRuleStore(tempPath());
    const r = rule();
    store.save(r);
    store.remove(r.id);
    expect(store.load()).toEqual([]);
  });

  it("persiste a disco — una nueva instancia sobre el mismo archivo recupera las alertas", () => {
    const filePath = tempPath();
    const store = new JsonFileAlertRuleStore(filePath);
    const r = rule();
    store.save(r);

    const reloaded = new JsonFileAlertRuleStore(filePath);
    expect(reloaded.load()).toEqual([r]);
  });
});
