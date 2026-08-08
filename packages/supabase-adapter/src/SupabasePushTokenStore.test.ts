import { describe, expect, it } from "vitest";
import { SupabasePushTokenStore } from "./SupabasePushTokenStore";
import { createFakeFromClient } from "./testFakes";

describe("SupabasePushTokenStore", () => {
  it("register() hace upsert por (user_id, token)", async () => {
    const client = createFakeFromClient({ push_tokens: { data: null, error: null } });
    const store = new SupabasePushTokenStore(client);

    await expect(store.register("u1", "ExponentPushToken[abc]", "android")).resolves.toBeUndefined();
  });

  it("register() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ push_tokens: { data: null, error: { message: "db caída" } } });
    const store = new SupabasePushTokenStore(client);

    await expect(store.register("u1", "ExponentPushToken[abc]", "android")).rejects.toThrow("db caída");
  });

  it("list() devuelve los tokens de un usuario", async () => {
    const client = createFakeFromClient({
      push_tokens: { data: [{ token: "tok-1" }, { token: "tok-2" }], error: null },
    });
    const store = new SupabasePushTokenStore(client);

    expect(await store.list("u1")).toEqual(["tok-1", "tok-2"]);
  });

  it("list() devuelve [] sin filas", async () => {
    const client = createFakeFromClient({ push_tokens: { data: [], error: null } });
    const store = new SupabasePushTokenStore(client);

    expect(await store.list("u1")).toEqual([]);
  });

  it("list() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ push_tokens: { data: null, error: { message: "db caída" } } });
    const store = new SupabasePushTokenStore(client);

    await expect(store.list("u1")).rejects.toThrow("db caída");
  });

  it("remove() no lanza en el camino feliz", async () => {
    const client = createFakeFromClient({ push_tokens: { data: null, error: null } });
    const store = new SupabasePushTokenStore(client);

    await expect(store.remove("u1", "tok-1")).resolves.toBeUndefined();
  });

  it("remove() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ push_tokens: { data: null, error: { message: "no encontrado" } } });
    const store = new SupabasePushTokenStore(client);

    await expect(store.remove("u1", "tok-1")).rejects.toThrow("no encontrado");
  });
});
