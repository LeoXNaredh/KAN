import { describe, expect, it } from "vitest";
import { SupabaseMemoryStore } from "./SupabaseMemoryStore";
import { createFakeFromClient, type RecordedCall } from "./testFakes";

describe("SupabaseMemoryStore", () => {
  it("list() traduce las filas a MemoryEntry[]", async () => {
    const client = createFakeFromClient({
      memories: {
        data: [
          { user_id: "u1", category: "preferencia", key: "unidad_temperatura", value: "celsius", updated_at: "2026-01-01T00:00:00.000Z" },
        ],
        error: null,
      },
    });
    const store = new SupabaseMemoryStore(client);

    expect(await store.list("u1")).toEqual([
      { userId: "u1", category: "preferencia", key: "unidad_temperatura", value: "celsius", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("list() filtra por categoría cuando se provee", async () => {
    const client = createFakeFromClient({
      memories: (calls: RecordedCall[]) => {
        const filteredByCategory = calls.some((call) => call.method === "eq" && call.args[0] === "category");
        return filteredByCategory ? { data: [], error: null } : { data: [{ id: "no-deberia-verse" }], error: null };
      },
    });
    const store = new SupabaseMemoryStore(client);

    expect(await store.list("u1", "preferencia")).toEqual([]);
  });

  it("list() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ memories: { data: null, error: { message: "db caída" } } });
    const store = new SupabaseMemoryStore(client);

    await expect(store.list("u1")).rejects.toThrow("db caída");
  });

  it("set() devuelve la entrada guardada", async () => {
    const client = createFakeFromClient({
      memories: {
        data: { user_id: "u1", category: "dispositivo", key: "esp32-cocina", value: { alias: "Cocina" }, updated_at: "2026-01-01T00:00:00.000Z" },
        error: null,
      },
    });
    const store = new SupabaseMemoryStore(client);

    expect(await store.set("u1", "dispositivo", "esp32-cocina", { alias: "Cocina" })).toEqual({
      userId: "u1",
      category: "dispositivo",
      key: "esp32-cocina",
      value: { alias: "Cocina" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("remove() no lanza en el camino feliz", async () => {
    const client = createFakeFromClient({ memories: { data: null, error: null } });
    const store = new SupabaseMemoryStore(client);

    await expect(store.remove("u1", "dispositivo", "esp32-cocina")).resolves.toBeUndefined();
  });

  it("remove() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ memories: { data: null, error: { message: "no encontrado" } } });
    const store = new SupabaseMemoryStore(client);

    await expect(store.remove("u1", "dispositivo", "esp32-cocina")).rejects.toThrow("no encontrado");
  });
});
