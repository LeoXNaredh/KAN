import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@kan/gateway-core";
import { SupabaseAuditStore } from "./SupabaseAuditStore";
import { createFakeFromClient, type RecordedCall } from "./testFakes";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "e1",
    at: "2026-01-01T00:00:00.000Z",
    actor: "llm",
    action: "tool.execute",
    subject: "read_sensor",
    metadata: {},
    ...overrides,
  };
}

describe("SupabaseAuditStore", () => {
  it("append() inserta la fila tal cual, sin lanzar", async () => {
    let insertedPayload: unknown;
    const client = createFakeFromClient({
      audit_entries: (calls: RecordedCall[]) => {
        insertedPayload = calls.find((call) => call.method === "insert")?.args[0];
        return { data: null, error: null };
      },
    });
    const store = new SupabaseAuditStore(client);

    await store.append(entry({ subject: "toggle_led" }));

    expect(insertedPayload).toMatchObject({ id: "e1", subject: "toggle_led", actor: "llm" });
  });

  it("append() no lanza si Supabase devuelve error — best-effort, igual que JsonlAuditStore", async () => {
    const client = createFakeFromClient({
      audit_entries: { data: null, error: { message: "conexión perdida" } },
    });
    const store = new SupabaseAuditStore(client);

    await expect(store.append(entry())).resolves.toBeUndefined();
  });

  it("list() sin filtro devuelve las filas ordenadas por at descendente", async () => {
    const rows = [entry({ id: "e2", at: "2026-01-02T00:00:00.000Z" }), entry({ id: "e1" })];
    const client = createFakeFromClient({
      audit_entries: { data: rows, error: null },
    });
    const store = new SupabaseAuditStore(client);

    expect(await store.list()).toEqual(rows);
  });

  it("list() aplica el filtro de actor/action/subject como .eq() encadenados", async () => {
    let recordedCalls: RecordedCall[] = [];
    const client = createFakeFromClient({
      audit_entries: (calls: RecordedCall[]) => {
        recordedCalls = calls;
        return { data: [], error: null };
      },
    });
    const store = new SupabaseAuditStore(client);

    await store.list({ actor: "user", action: "audit.local", subject: "fake-1/toggle_led" });

    const eqCalls = recordedCalls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(eqCalls).toEqual([
      ["actor", "user"],
      ["action", "audit.local"],
      ["subject", "fake-1/toggle_led"],
    ]);
  });

  it("list() lanza si Supabase devuelve error (a diferencia de append(), no es best-effort)", async () => {
    const client = createFakeFromClient({
      audit_entries: { data: null, error: { message: "tabla no encontrada" } },
    });
    const store = new SupabaseAuditStore(client);

    await expect(store.list()).rejects.toThrow("tabla no encontrada");
  });
});
