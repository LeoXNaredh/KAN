import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseDeviceSnapshotStore } from "./SupabaseDeviceSnapshotStore";
import { createFakeFromClient, type RecordedCall } from "./testFakes";

const ROW = {
  id: "snap-1",
  user_id: "user-1",
  edge_agent_id: "agent-1",
  device_id: "device-1",
  device_name: "Pico del taller",
  device_kind: "micropython",
  backup_type: "source",
  label: "antes del cambio de motor",
  storage_object_path: "user-1/device-1/snap-1.json",
  size_bytes: 512,
  file_count: 3,
  created_at: "2026-08-01T00:00:00.000Z",
};

const RECORD = {
  id: "snap-1",
  userId: "user-1",
  edgeAgentId: "agent-1",
  deviceId: "device-1",
  deviceName: "Pico del taller",
  deviceKind: "micropython",
  backupType: "source",
  label: "antes del cambio de motor",
  storageObjectPath: "user-1/device-1/snap-1.json",
  sizeBytes: 512,
  fileCount: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
};

/** `createFakeFromClient` solo fakea `.from()` (tablas) — acá se le agrega `.storage` para el caso de Storage. */
function withFakeStorage(
  client: SupabaseClient,
  overrides: {
    createSignedUploadUrl?: ReturnType<typeof vi.fn>;
    createSignedUrl?: ReturnType<typeof vi.fn>;
    upload?: ReturnType<typeof vi.fn>;
    download?: ReturnType<typeof vi.fn>;
  },
): SupabaseClient {
  return Object.assign(client, {
    storage: { from: (_bucket: string) => overrides },
  });
}

describe("SupabaseDeviceSnapshotStore", () => {
  it("create() inserta la fila y devuelve el record mapeado", async () => {
    const client = createFakeFromClient({ device_snapshots: { data: ROW, error: null } });
    const store = new SupabaseDeviceSnapshotStore(client);

    const record = await store.create({
      userId: "user-1",
      edgeAgentId: "agent-1",
      deviceId: "device-1",
      deviceName: "Pico del taller",
      deviceKind: "micropython",
      backupType: "source",
      label: "antes del cambio de motor",
      storageObjectPath: "user-1/device-1/snap-1.json",
      sizeBytes: 512,
      fileCount: 3,
    });

    expect(record).toEqual(RECORD);
  });

  it("create() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ device_snapshots: { data: null, error: { message: "columna inválida" } } });
    const store = new SupabaseDeviceSnapshotStore(client);

    await expect(
      store.create({
        userId: "user-1",
        edgeAgentId: "agent-1",
        deviceId: "device-1",
        deviceKind: "micropython",
        backupType: "source",
        storageObjectPath: "x.json",
      }),
    ).rejects.toThrow("columna inválida");
  });

  it("listByUser() filtra por user_id y ordena por created_at descendente", async () => {
    let recordedCalls: RecordedCall[] = [];
    const client = createFakeFromClient({
      device_snapshots: (calls: RecordedCall[]) => {
        recordedCalls = calls;
        return { data: [ROW], error: null };
      },
    });
    const store = new SupabaseDeviceSnapshotStore(client);

    const records = await store.listByUser("user-1");

    expect(records).toEqual([RECORD]);
    const eqCalls = recordedCalls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqCalls).toEqual([["user_id", "user-1"]]);
    const orderCalls = recordedCalls.filter((c) => c.method === "order").map((c) => c.args);
    expect(orderCalls).toEqual([["created_at", { ascending: false }]]);
  });

  it("listByUser() agrega el filtro por device_id cuando se pasa", async () => {
    let recordedCalls: RecordedCall[] = [];
    const client = createFakeFromClient({
      device_snapshots: (calls: RecordedCall[]) => {
        recordedCalls = calls;
        return { data: [ROW], error: null };
      },
    });
    const store = new SupabaseDeviceSnapshotStore(client);

    await store.listByUser("user-1", "device-1");

    const eqCalls = recordedCalls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqCalls).toEqual([
      ["user_id", "user-1"],
      ["device_id", "device-1"],
    ]);
  });

  it("get() devuelve undefined si no existe", async () => {
    const client = createFakeFromClient({ device_snapshots: { data: null, error: null } });
    const store = new SupabaseDeviceSnapshotStore(client);

    expect(await store.get("no-existe")).toBeUndefined();
  });

  it("delete() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ device_snapshots: { data: null, error: { message: "no se pudo borrar" } } });
    const store = new SupabaseDeviceSnapshotStore(client);

    await expect(store.delete("snap-1")).rejects.toThrow("no se pudo borrar");
  });

  it("createSignedUploadUrl() devuelve signedUrl + token del bucket privado", async () => {
    const createSignedUploadUrl = vi.fn(async () => ({
      data: { signedUrl: "https://example.supabase.co/upload/abc", token: "tok-123", path: "user-1/device-1/snap-1.json" },
      error: null,
    }));
    const client = withFakeStorage(createFakeFromClient({}), { createSignedUploadUrl });
    const store = new SupabaseDeviceSnapshotStore(client);

    const target = await store.createSignedUploadUrl("user-1/device-1/snap-1.json");

    expect(target).toEqual({ signedUrl: "https://example.supabase.co/upload/abc", token: "tok-123" });
    expect(createSignedUploadUrl).toHaveBeenCalledWith("user-1/device-1/snap-1.json");
  });

  it("createSignedDownloadUrl() devuelve la signed URL con el TTL pedido", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://example.supabase.co/signed/abc" }, error: null }));
    const client = withFakeStorage(createFakeFromClient({}), { createSignedUrl });
    const store = new SupabaseDeviceSnapshotStore(client);

    const url = await store.createSignedDownloadUrl("user-1/device-1/snap-1.json", 300);

    expect(url).toBe("https://example.supabase.co/signed/abc");
    expect(createSignedUrl).toHaveBeenCalledWith("user-1/device-1/snap-1.json", 300);
  });

  it("createSignedDownloadUrl() lanza si Supabase Storage devuelve error", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: null, error: { message: "objeto no encontrado" } }));
    const client = withFakeStorage(createFakeFromClient({}), { createSignedUrl });
    const store = new SupabaseDeviceSnapshotStore(client);

    await expect(store.createSignedDownloadUrl("no-existe.json", 300)).rejects.toThrow("objeto no encontrado");
  });

  it("uploadContent() sube el buffer directo, sin signed URL", async () => {
    const upload = vi.fn(async () => ({ data: { path: "user-1/device-1/config.json" }, error: null }));
    const client = withFakeStorage(createFakeFromClient({}), { upload });
    const store = new SupabaseDeviceSnapshotStore(client);
    const content = Buffer.from(JSON.stringify({ ok: true }), "utf-8");

    await store.uploadContent("user-1/device-1/config.json", content);

    expect(upload).toHaveBeenCalledWith("user-1/device-1/config.json", content, { contentType: "application/json", upsert: false });
  });

  it("uploadContent() lanza si Supabase Storage devuelve error", async () => {
    const upload = vi.fn(async () => ({ data: null, error: { message: "bucket lleno" } }));
    const client = withFakeStorage(createFakeFromClient({}), { upload });
    const store = new SupabaseDeviceSnapshotStore(client);

    await expect(store.uploadContent("x.json", Buffer.from("{}"))).rejects.toThrow("bucket lleno");
  });

  it("downloadContent() devuelve el contenido como Buffer", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ok: true })).buffer;
    const download = vi.fn(async () => ({ data: { arrayBuffer: async () => bytes }, error: null }));
    const client = withFakeStorage(createFakeFromClient({}), { download });
    const store = new SupabaseDeviceSnapshotStore(client);

    const content = await store.downloadContent("user-1/device-1/config.json");

    expect(content.equals(Buffer.from(bytes))).toBe(true);
    expect(download).toHaveBeenCalledWith("user-1/device-1/config.json");
  });

  it("downloadContent() lanza si Supabase Storage devuelve error", async () => {
    const download = vi.fn(async () => ({ data: null, error: { message: "objeto no encontrado" } }));
    const client = withFakeStorage(createFakeFromClient({}), { download });
    const store = new SupabaseDeviceSnapshotStore(client);

    await expect(store.downloadContent("no-existe.json")).rejects.toThrow("objeto no encontrado");
  });
});
