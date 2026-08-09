import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SupabasePairingStore } from "./SupabasePairingStore";
import { createFakeFromClient } from "./testFakes";

describe("SupabasePairingStore", () => {
  it("generateCode() inserta un código de 8 caracteres con vencimiento a 10 minutos", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: null } });
    const store = new SupabasePairingStore(client);

    const before = Date.now();
    const result = await store.generateCode("user-1");
    const after = Date.now();

    expect(result.code).toMatch(/^[A-Z0-9]{8}$/);
    const expiresAtMs = new Date(result.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(expiresAtMs).toBeLessThan(after + 11 * 60 * 1000);
  });

  it("generateCode() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: { message: "db caída" } } });
    const store = new SupabasePairingStore(client);

    await expect(store.generateCode("user-1")).rejects.toThrow("db caída");
  });

  it("claim() devuelve el ownerId y un secreto cuando el código es válido", async () => {
    const client = createFakeFromClient({
      edge_agent_pairings: { data: { user_id: "user-1" }, error: null },
    });
    const store = new SupabasePairingStore(client);

    const result = await store.claim("ABCD1234", "agent-1");

    expect(result).toBeDefined();
    expect(result!.ownerId).toBe("user-1");
    expect(result!.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("claim() devuelve undefined si el UPDATE no afecta ninguna fila (código inválido, vencido, ya usado, o carrera perdida)", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: null } });
    const store = new SupabasePairingStore(client);

    expect(await store.claim("NOEXISTE", "agent-1")).toBeUndefined();
  });

  it("claim() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: { message: "db caída" } } });
    const store = new SupabasePairingStore(client);

    await expect(store.claim("ABCD1234", "agent-1")).rejects.toThrow("db caída");
  });

  it("claim() nunca guarda el secreto en texto plano — solo su hash", async () => {
    let insertedUpdate: Record<string, unknown> | undefined;
    const client = createFakeFromClient({
      edge_agent_pairings: (calls) => {
        const updateCall = calls.find((call) => call.method === "update");
        insertedUpdate = updateCall?.args[0] as Record<string, unknown>;
        return { data: { user_id: "user-1" }, error: null };
      },
    });
    const store = new SupabasePairingStore(client);

    const result = await store.claim("ABCD1234", "agent-1");

    expect(insertedUpdate?.pairing_secret_hash).toBe(createHash("sha256").update(result!.secret).digest("hex"));
    expect(insertedUpdate?.pairing_secret_hash).not.toBe(result!.secret);
  });

  it("resolveOwner() devuelve el ownerId si el hash del secreto coincide", async () => {
    const client = createFakeFromClient({
      edge_agent_pairings: { data: { user_id: "user-1" }, error: null },
    });
    const store = new SupabasePairingStore(client);

    expect(await store.resolveOwner("cualquier-secreto", "agent-1")).toBe("user-1");
  });

  it("resolveOwner() devuelve undefined si no hay ningún pairing que coincida", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: null } });
    const store = new SupabasePairingStore(client);

    expect(await store.resolveOwner("secreto-invalido", "agent-1")).toBeUndefined();
  });

  it("resolveOwner() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: { message: "db caída" } } });
    const store = new SupabasePairingStore(client);

    await expect(store.resolveOwner("secreto", "agent-1")).rejects.toThrow("db caída");
  });

  it("claim() adjunta la config de plugins ya guardada en user_preferences, sin las keys que no son plugin_config:*", async () => {
    const client = createFakeFromClient({
      edge_agent_pairings: { data: { user_id: "user-1" }, error: null },
      user_preferences: {
        data: [
          { key: "plugin_config:KAN_SSH_HOSTS", value: "casa|192.168.1.20:22|kan|password|x" },
          { key: "plugin_config:KAN_MQTT_BROKERS", value: "mqtt://192.168.1.10:1883" },
        ],
        error: null,
      },
    });
    const store = new SupabasePairingStore(client);

    const result = await store.claim("ABCD1234", "agent-1");

    expect(result?.pluginConfig).toEqual({
      KAN_SSH_HOSTS: "casa|192.168.1.20:22|kan|password|x",
      KAN_MQTT_BROKERS: "mqtt://192.168.1.10:1883",
    });
  });

  it("claim() sigue devolviendo ownerId/secret aunque falle la lectura de plugin config (best-effort)", async () => {
    const client = createFakeFromClient({
      edge_agent_pairings: { data: { user_id: "user-1" }, error: null },
      user_preferences: { data: null, error: { message: "db caída" } },
    });
    const store = new SupabasePairingStore(client);

    const result = await store.claim("ABCD1234", "agent-1");

    expect(result?.ownerId).toBe("user-1");
    expect(result?.pluginConfig).toBeUndefined();
  });

  it("getPluginConfig() devuelve la config si el secreto resuelve a un owner", async () => {
    const client = createFakeFromClient({
      edge_agent_pairings: { data: { user_id: "user-1" }, error: null },
      user_preferences: {
        data: [{ key: "plugin_config:KAN_SSH_HOSTS", value: "casa|192.168.1.20:22|kan|password|x" }],
        error: null,
      },
    });
    const store = new SupabasePairingStore(client);

    expect(await store.getPluginConfig("secreto-valido", "agent-1")).toEqual({
      KAN_SSH_HOSTS: "casa|192.168.1.20:22|kan|password|x",
    });
  });

  it("getPluginConfig() devuelve undefined si el secreto no resuelve a ningún pairing", async () => {
    const client = createFakeFromClient({ edge_agent_pairings: { data: null, error: null } });
    const store = new SupabasePairingStore(client);

    expect(await store.getPluginConfig("secreto-invalido", "agent-1")).toBeUndefined();
  });
});
