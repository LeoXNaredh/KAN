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

  it("append() hace visible la entrada de inmediato en list() (lectura en memoria, no del disco)", async () => {
    const store = tempStore();
    await store.append(entry({ subject: "ref-a" }));
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].subject).toBe("ref-a");
  });

  it("list() filtra por actor/action/subject", async () => {
    const store = tempStore();
    await store.append(entry({ subject: "ref-a", action: "tool.execute" }));
    await store.append(entry({ subject: "ref-b", action: "tool.propose" }));

    expect(await store.list({ subject: "ref-a" })).toHaveLength(1);
    expect(await store.list({ action: "tool.propose" })).toHaveLength(1);
    expect(await store.list({ subject: "no-existe" })).toHaveLength(0);
  });

  it("persiste a disco de forma asíncrona (no bloquea append(), hallazgo A8 de docs/13)", async () => {
    const filePath = join(tmpdir(), `kan-audit-test-${randomUUID()}.jsonl`);
    tempFiles.push(filePath);
    const store = new JsonlAuditStore(filePath);

    // No se espera la promesa de append(): la escritura a disco en sí sigue
    // sin bloquear — se le da un tick al event loop antes de verificar el archivo.
    void store.append(entry({ subject: "ref-durable" }));
    await sleep(50);

    expect(existsSync(filePath)).toBe(true);
    const reloaded = new JsonlAuditStore(filePath);
    expect(await reloaded.list()).toHaveLength(1);
    expect((await reloaded.list())[0].subject).toBe("ref-durable");
  });

  it("un archivo inexistente arranca con lista vacía sin lanzar", async () => {
    const store = tempStore();
    expect(await store.list()).toEqual([]);
  });
});
