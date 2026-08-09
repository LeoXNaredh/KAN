import { describe, expect, it } from "vitest";
import { SupabaseProjectsAdapter } from "./SupabaseProjectsAdapter";
import { createFakeFromClient, type RecordedCall } from "./testFakes";

describe("SupabaseProjectsAdapter", () => {
  it("list() traduce las filas a Project[]", async () => {
    const client = createFakeFromClient({
      projects: {
        data: [
          {
            id: "p1",
            user_id: "u1",
            name: "Impresora 3D",
            description: "Cabina cerrada",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    const adapter = new SupabaseProjectsAdapter(client);

    expect(await adapter.list("u1")).toEqual([
      {
        id: "p1",
        userId: "u1",
        name: "Impresora 3D",
        description: "Cabina cerrada",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("list() filtra por user_id", async () => {
    const client = createFakeFromClient({
      projects: (calls: RecordedCall[]) => {
        const filteredByUser = calls.some((call) => call.method === "eq" && call.args[0] === "user_id" && call.args[1] === "u1");
        return filteredByUser ? { data: [], error: null } : { data: [{ id: "no-deberia-verse" }], error: null };
      },
    });
    const adapter = new SupabaseProjectsAdapter(client);

    expect(await adapter.list("u1")).toEqual([]);
  });

  it("list() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ projects: { data: null, error: { message: "db caída" } } });
    const adapter = new SupabaseProjectsAdapter(client);

    await expect(adapter.list("u1")).rejects.toThrow("db caída");
  });

  it("create() devuelve el proyecto creado", async () => {
    const client = createFakeFromClient({
      projects: {
        data: {
          id: "p1",
          user_id: "u1",
          name: "Impresora 3D",
          description: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        error: null,
      },
    });
    const adapter = new SupabaseProjectsAdapter(client);

    expect(await adapter.create("u1", "Impresora 3D")).toEqual({
      id: "p1",
      userId: "u1",
      name: "Impresora 3D",
      description: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("create() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ projects: { data: null, error: { message: "nombre requerido" } } });
    const adapter = new SupabaseProjectsAdapter(client);

    await expect(adapter.create("u1", "")).rejects.toThrow("nombre requerido");
  });

  it("remove() no lanza en el camino feliz", async () => {
    const client = createFakeFromClient({ projects: { data: null, error: null } });
    const adapter = new SupabaseProjectsAdapter(client);

    await expect(adapter.remove("u1", "p1")).resolves.toBeUndefined();
  });

  it("remove() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ projects: { data: null, error: { message: "no encontrado" } } });
    const adapter = new SupabaseProjectsAdapter(client);

    await expect(adapter.remove("u1", "p1")).rejects.toThrow("no encontrado");
  });
});
