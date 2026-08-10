import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabasePluginRegistry } from "./SupabasePluginRegistry";
import { createFakeFromClient, type RecordedCall } from "./testFakes";

const ROW = {
  id: "kan-plugin-vision-py",
  version: "0.1.0",
  display_name: "Visión artificial (OpenCV)",
  kind: "device-driver",
  runtime: "python-sidecar",
  permissions: { devices: ["camera-usb"], network: false, filesystem: [] },
  description: "Detecta caras vía OpenCV.",
  storage_object_path: "kan-plugin-vision-py/0.1.0.tar.gz",
};

/** `createFakeFromClient` solo fakea `.from()` (tablas) — acá se le agrega `.storage` para el caso de Storage. */
function withFakeStorage(client: SupabaseClient, createSignedUrl: ReturnType<typeof vi.fn>): SupabaseClient {
  return Object.assign(client, {
    storage: { from: (_bucket: string) => ({ createSignedUrl }) },
  });
}

describe("SupabasePluginRegistry", () => {
  it("listCatalog() mapea las filas a PluginCatalogEntry", async () => {
    const client = createFakeFromClient({ plugin_registry: { data: [ROW], error: null } });
    const registry = new SupabasePluginRegistry(client);

    const catalog = await registry.listCatalog();

    expect(catalog).toEqual([
      {
        manifest: {
          id: "kan-plugin-vision-py",
          version: "0.1.0",
          displayName: "Visión artificial (OpenCV)",
          kind: "device-driver",
          runtime: "python-sidecar",
          permissions: { devices: ["camera-usb"], network: false, filesystem: [] },
        },
        description: "Detecta caras vía OpenCV.",
      },
    ]);
  });

  it("listCatalog() lanza si Supabase devuelve error", async () => {
    const client = createFakeFromClient({ plugin_registry: { data: null, error: { message: "tabla no encontrada" } } });
    const registry = new SupabasePluginRegistry(client);

    await expect(registry.listCatalog()).rejects.toThrow("tabla no encontrada");
  });

  it("getDownloadRef() devuelve la referencia de storage + manifest para un plugin existente", async () => {
    const client = createFakeFromClient({ plugin_registry: { data: ROW, error: null } });
    const registry = new SupabasePluginRegistry(client);

    const ref = await registry.getDownloadRef("kan-plugin-vision-py");

    expect(ref).toEqual({
      storageObjectPath: "kan-plugin-vision-py/0.1.0.tar.gz",
      manifest: expect.objectContaining({ id: "kan-plugin-vision-py" }),
    });
  });

  it("getDownloadRef() consulta por id con .eq()", async () => {
    let recordedCalls: RecordedCall[] = [];
    const client = createFakeFromClient({
      plugin_registry: (calls: RecordedCall[]) => {
        recordedCalls = calls;
        return { data: ROW, error: null };
      },
    });
    const registry = new SupabasePluginRegistry(client);

    await registry.getDownloadRef("kan-plugin-vision-py");

    const eqCalls = recordedCalls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(eqCalls).toEqual([["id", "kan-plugin-vision-py"]]);
  });

  it("getDownloadRef() devuelve undefined para un plugin que no existe en el catálogo", async () => {
    const client = createFakeFromClient({ plugin_registry: { data: null, error: null } });
    const registry = new SupabasePluginRegistry(client);

    expect(await registry.getDownloadRef("no-existe")).toBeUndefined();
  });

  it("createSignedDownloadUrl() devuelve la signed URL del bucket privado", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://example.supabase.co/signed/abc" }, error: null }));
    const client = withFakeStorage(createFakeFromClient({}), createSignedUrl);
    const registry = new SupabasePluginRegistry(client);

    const url = await registry.createSignedDownloadUrl("kan-plugin-vision-py/0.1.0.tar.gz", 300);

    expect(url).toBe("https://example.supabase.co/signed/abc");
    expect(createSignedUrl).toHaveBeenCalledWith("kan-plugin-vision-py/0.1.0.tar.gz", 300);
  });

  it("createSignedDownloadUrl() lanza si Supabase Storage devuelve error", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: null, error: { message: "objeto no encontrado" } }));
    const client = withFakeStorage(createFakeFromClient({}), createSignedUrl);
    const registry = new SupabasePluginRegistry(client);

    await expect(registry.createSignedDownloadUrl("no-existe.tar.gz", 300)).rejects.toThrow("objeto no encontrado");
  });
});
