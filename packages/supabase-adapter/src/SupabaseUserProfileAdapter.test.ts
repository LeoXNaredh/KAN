import { describe, expect, it } from "vitest";
import { SupabaseUserProfileAdapter } from "./SupabaseUserProfileAdapter";
import { createFakeFromClient } from "./testFakes";

describe("SupabaseUserProfileAdapter", () => {
  it("getProfile traduce la fila de la tabla a UserProfile", async () => {
    const client = createFakeFromClient({
      profiles: { data: { id: "u1", display_name: "Ada", created_at: "2026-01-01T00:00:00.000Z" }, error: null },
    });
    const adapter = new SupabaseUserProfileAdapter(client);

    expect(await adapter.getProfile("u1")).toEqual({
      userId: "u1",
      displayName: "Ada",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("getProfile devuelve undefined si no existe la fila", async () => {
    const client = createFakeFromClient({ profiles: { data: null, error: null } });
    const adapter = new SupabaseUserProfileAdapter(client);

    expect(await adapter.getProfile("no-existe")).toBeUndefined();
  });

  it("getProfile lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ profiles: { data: null, error: { message: "db caída" } } });
    const adapter = new SupabaseUserProfileAdapter(client);

    await expect(adapter.getProfile("u1")).rejects.toThrow("db caída");
  });

  it("updateDisplayName devuelve el perfil actualizado", async () => {
    const client = createFakeFromClient({
      profiles: { data: { id: "u1", display_name: "Nuevo Nombre", created_at: "2026-01-01T00:00:00.000Z" }, error: null },
    });
    const adapter = new SupabaseUserProfileAdapter(client);

    expect(await adapter.updateDisplayName("u1", "Nuevo Nombre")).toMatchObject({ displayName: "Nuevo Nombre" });
  });

  it("getDashboardSummary combina perfil y conteos reales de projects/memories", async () => {
    const client = createFakeFromClient({
      profiles: { data: { id: "u1", display_name: "Ada", created_at: "2026-01-01T00:00:00.000Z" }, error: null },
      projects: { data: null, error: null, count: 2 },
      memories: { data: null, error: null, count: 0 },
    });
    const adapter = new SupabaseUserProfileAdapter(client);

    expect(await adapter.getDashboardSummary("u1")).toEqual({
      profile: { userId: "u1", displayName: "Ada", createdAt: "2026-01-01T00:00:00.000Z" },
      projectsCount: 2,
      memoriesCount: 0,
    });
  });

  it("getDashboardSummary funciona con un perfil todavía inexistente (fallback mínimo, no lanza)", async () => {
    const client = createFakeFromClient({
      profiles: { data: null, error: null },
      projects: { data: null, error: null, count: 0 },
      memories: { data: null, error: null, count: 0 },
    });
    const adapter = new SupabaseUserProfileAdapter(client);

    const summary = await adapter.getDashboardSummary("u1");
    expect(summary.profile.userId).toBe("u1");
    expect(summary.projectsCount).toBe(0);
    expect(summary.memoriesCount).toBe(0);
  });
});
