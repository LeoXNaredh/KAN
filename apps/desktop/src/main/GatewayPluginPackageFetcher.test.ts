import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStorePort } from "@kan/edge-agent-core";
import { GatewayPluginPackageFetcher } from "./GatewayPluginPackageFetcher";

const MANIFEST = {
  id: "kan-plugin-vision-py",
  version: "0.1.0",
  displayName: "Visión artificial (OpenCV)",
  kind: "device-driver" as const,
  runtime: "python-sidecar" as const,
  permissions: { devices: ["camera-usb"], network: false, filesystem: [] },
};

function configStoreWithToken(pairingToken: string | undefined): ConfigStorePort {
  return {
    get: <T>(key: string) => (key === "pairingToken" ? (pairingToken as T | undefined) : undefined),
    set: () => {},
    all: () => ({}),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

describe("GatewayPluginPackageFetcher", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("sin vincular (sin pairingToken)", () => {
    it("listCatalog() lanza sin llamar a fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken(undefined), "agent-1", "http://gw");

      await expect(fetcher.listCatalog()).rejects.toThrow(/Todavía no vinculaste/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fetch() lanza sin llamar a fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken(undefined), "agent-1", "http://gw");

      await expect(fetcher.fetch("kan-plugin-vision-py")).rejects.toThrow(/Todavía no vinculaste/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("listCatalog()", () => {
    it("manda los headers de pairing y devuelve el catálogo", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(200, { catalog: [{ manifest: MANIFEST, description: "Detecta caras." }] }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken("secreto-largo"), "agent-1", "http://gw");

      const catalog = await fetcher.listCatalog();

      expect(catalog).toEqual([{ manifest: MANIFEST, description: "Detecta caras." }]);
      expect(fetchMock).toHaveBeenCalledWith("http://gw/v1/plugins/catalog", {
        headers: { "X-Pairing-Secret": "secreto-largo", "X-Edge-Agent-Id": "agent-1" },
      });
    });

    it("lanza con el error del Gateway si la respuesta no es ok", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: "Secreto de pairing inválido." }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(fetcher.listCatalog()).rejects.toThrow("Secreto de pairing inválido.");
    });
  });

  describe("fetch()", () => {
    it("pide la signed URL al Gateway y descarga el archivo desde ahí, sin headers propios", async () => {
      const archiveBytes = new TextEncoder().encode("contenido-fake-del-tar-gz").buffer;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            downloadUrl: "https://example.supabase.co/signed/abc",
            expiresAt: new Date().toISOString(),
            manifest: MANIFEST,
          }),
        )
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => archiveBytes });
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken("secreto-largo"), "agent-1", "http://gw");

      const result = await fetcher.fetch("kan-plugin-vision-py");

      expect(result.manifest).toEqual(MANIFEST);
      expect(Buffer.compare(result.archive, Buffer.from(archiveBytes))).toBe(0);
      expect(fetchMock).toHaveBeenNthCalledWith(1, "http://gw/v1/plugins/kan-plugin-vision-py/download", {
        method: "POST",
        headers: { "X-Pairing-Secret": "secreto-largo", "X-Edge-Agent-Id": "agent-1" },
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://example.supabase.co/signed/abc");
    });

    it("codifica el pluginId en la URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: "no encontrado" }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(fetcher.fetch("kan/plugin raro")).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw/v1/plugins/kan%2Fplugin%20raro/download",
        expect.anything(),
      );
    });

    it("lanza si el Gateway no devuelve downloadUrl/manifest", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(fetcher.fetch("kan-plugin-vision-py")).rejects.toThrow(/No se pudo iniciar la descarga/);
    });

    it("lanza si la descarga del archivo desde la signed URL falla", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { downloadUrl: "https://example.supabase.co/signed/abc", manifest: MANIFEST }),
        )
        .mockResolvedValueOnce({ ok: false });
      global.fetch = fetchMock as unknown as typeof fetch;
      const fetcher = new GatewayPluginPackageFetcher(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(fetcher.fetch("kan-plugin-vision-py")).rejects.toThrow(/No se pudo descargar el paquete/);
    });
  });
});
