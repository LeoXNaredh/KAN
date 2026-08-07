import { describe, expect, it } from "vitest";
import { SupabaseUserPreferencesStore } from "./SupabaseUserPreferencesStore";
import { createFakeFromClient } from "./testFakes";

describe("SupabaseUserPreferencesStore", () => {
  it("list() traduce las filas a UserPreference[]", async () => {
    const client = createFakeFromClient({
      user_preferences: {
        data: [{ user_id: "u1", key: "personality", value: "Sé breve y directo.", updated_at: "2026-01-01T00:00:00.000Z" }],
        error: null,
      },
    });
    const store = new SupabaseUserPreferencesStore(client);

    expect(await store.list("u1")).toEqual([
      { userId: "u1", key: "personality", value: "Sé breve y directo.", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("list() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ user_preferences: { data: null, error: { message: "db caída" } } });
    const store = new SupabaseUserPreferencesStore(client);

    await expect(store.list("u1")).rejects.toThrow("db caída");
  });

  it("get() devuelve undefined si no existe la preferencia", async () => {
    const client = createFakeFromClient({ user_preferences: { data: null, error: null } });
    const store = new SupabaseUserPreferencesStore(client);

    expect(await store.get("u1", "personality")).toBeUndefined();
  });

  it("get() traduce la fila cuando existe", async () => {
    const client = createFakeFromClient({
      user_preferences: {
        data: { user_id: "u1", key: "personality", value: "Formal y técnico.", updated_at: "2026-01-01T00:00:00.000Z" },
        error: null,
      },
    });
    const store = new SupabaseUserPreferencesStore(client);

    expect(await store.get("u1", "personality")).toEqual({
      userId: "u1",
      key: "personality",
      value: "Formal y técnico.",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("set() devuelve la preferencia guardada", async () => {
    const client = createFakeFromClient({
      user_preferences: {
        data: { user_id: "u1", key: "personality", value: "Casual.", updated_at: "2026-01-01T00:00:00.000Z" },
        error: null,
      },
    });
    const store = new SupabaseUserPreferencesStore(client);

    expect(await store.set("u1", "personality", "Casual.")).toEqual({
      userId: "u1",
      key: "personality",
      value: "Casual.",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("remove() no lanza en el camino feliz", async () => {
    const client = createFakeFromClient({ user_preferences: { data: null, error: null } });
    const store = new SupabaseUserPreferencesStore(client);

    await expect(store.remove("u1", "personality")).resolves.toBeUndefined();
  });

  it("remove() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ user_preferences: { data: null, error: { message: "no encontrado" } } });
    const store = new SupabaseUserPreferencesStore(client);

    await expect(store.remove("u1", "personality")).rejects.toThrow("no encontrado");
  });
});
