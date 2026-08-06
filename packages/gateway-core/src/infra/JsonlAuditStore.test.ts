import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonlAuditStore } from "./JsonlAuditStore";
import type { AuditEntry } from "../domain/entities/AuditEntry";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: "llm",
    action: "tool.execute",
    subject: "some_ref",
    metadata: {},
    ...overrides,
  };
}

describe("JsonlAuditStore", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles.splice(0)) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  function tempStore(): JsonlAuditStore {
    const filePath = join(tmpdir(), `kan-audit-test-${randomUUID()}.jsonl`);
    tempFiles.push(filePath);
    return new JsonlAuditStore(filePath);
  }

  it("append() hace visible la entrada de inmediato en list() (lectura en memoria, no del disco)", () => {
    const store = tempStore();
    store.append(entry({ subject: "ref-a" }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].subject).toBe("ref-a");
  });

  it("list() filtra por actor/action/subject", () => {
    const store = tempStore();
    store.append(entry({ subject: "ref-a", action: "tool.execute" }));
    store.append(entry({ subject: "ref-b", action: "tool.propose" }));

    expect(store.list({ subject: "ref-a" })).toHaveLength(1);
    expect(store.list({ action: "tool.propose" })).toHaveLength(1);
    expect(store.list({ subject: "no-existe" })).toHaveLength(0);
  });

  it("persiste a disco de forma asíncrona (no bloquea append(), hallazgo A8 de docs/13)", async () => {
    const filePath = join(tmpdir(), `kan-audit-test-${randomUUID()}.jsonl`);
    tempFiles.push(filePath);
    const store = new JsonlAuditStore(filePath);

    store.append(entry({ subject: "ref-durable" }));
    // append() no espera al disco — se le da un tick al event loop antes de verificar el archivo.
    await sleep(50);

    expect(existsSync(filePath)).toBe(true);
    const reloaded = new JsonlAuditStore(filePath);
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0].subject).toBe("ref-durable");
  });

  it("un archivo inexistente arranca con lista vacía sin lanzar", () => {
    const store = tempStore();
    expect(store.list()).toEqual([]);
  });
});
