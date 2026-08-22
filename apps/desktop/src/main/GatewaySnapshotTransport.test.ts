import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStorePort } from "@kan/edge-agent-core";
import { GatewaySnapshotTransport } from "./GatewaySnapshotTransport";

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

describe("GatewaySnapshotTransport", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("sin vincular (sin pairingToken)", () => {
    it("upload() lanza sin llamar a fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken(undefined), "agent-1", "http://gw");

      await expect(
        transport.upload({ deviceId: "device-1", deviceKind: "micropython", backupType: "source", content: Buffer.from("x") }),
      ).rejects.toThrow(/Todavía no vinculaste/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("download() lanza sin llamar a fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken(undefined), "agent-1", "http://gw");

      await expect(transport.download("device-1", "snap-1")).rejects.toThrow(/Todavía no vinculaste/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("upload()", () => {
    it("pide la signed upload URL, sube el contenido, y confirma el snapshot", async () => {
      const content = Buffer.from("contenido-fake-del-snapshot");
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, { signedUrl: "https://example.supabase.co/upload/abc", token: "tok-123", storageObjectPath: "u/d/s.json" }),
        )
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(jsonResponse(201, { snapshot: { id: "snap-1" } }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto-largo"), "agent-1", "http://gw");

      const result = await transport.upload({
        deviceId: "device-1",
        deviceKind: "micropython",
        backupType: "source",
        label: "antes del cambio",
        content,
      });

      expect(result).toEqual({ snapshotId: "snap-1" });
      expect(fetchMock).toHaveBeenNthCalledWith(1, "http://gw/v1/devices/device-1/snapshots/upload-url", {
        method: "POST",
        headers: { "X-Pairing-Secret": "secreto-largo", "X-Edge-Agent-Id": "agent-1", "Content-Type": "application/json" },
        body: JSON.stringify({ backupType: "source" }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://example.supabase.co/upload/abc", {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" },
        body: content,
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, "http://gw/v1/devices/device-1/snapshots/confirm", {
        method: "POST",
        headers: { "X-Pairing-Secret": "secreto-largo", "X-Edge-Agent-Id": "agent-1", "Content-Type": "application/json" },
        body: JSON.stringify({
          storageObjectPath: "u/d/s.json",
          backupType: "source",
          deviceKind: "micropython",
          label: "antes del cambio",
          sizeBytes: content.byteLength,
        }),
      });
    });

    it("lanza si el Gateway no devuelve signedUrl/storageObjectPath", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(
        transport.upload({ deviceId: "device-1", deviceKind: "micropython", backupType: "source", content: Buffer.from("x") }),
      ).rejects.toThrow(/No se pudo iniciar la subida/);
    });

    it("lanza si la subida a la signed URL falla", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { signedUrl: "https://example.supabase.co/upload/abc", token: "t", storageObjectPath: "u/d/s.json" }))
        .mockResolvedValueOnce({ ok: false });
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(
        transport.upload({ deviceId: "device-1", deviceKind: "micropython", backupType: "source", content: Buffer.from("x") }),
      ).rejects.toThrow(/No se pudo subir el snapshot/);
    });

    it("lanza si la confirmación falla", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { signedUrl: "https://example.supabase.co/upload/abc", token: "t", storageObjectPath: "u/d/s.json" }))
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(jsonResponse(500, { error: "no se pudo confirmar" }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(
        transport.upload({ deviceId: "device-1", deviceKind: "micropython", backupType: "source", content: Buffer.from("x") }),
      ).rejects.toThrow("no se pudo confirmar");
    });
  });

  describe("download()", () => {
    it("pide la signed download URL al Gateway y descarga el contenido desde ahí, sin headers propios", async () => {
      const contentBytes = new TextEncoder().encode("contenido-fake-del-snapshot").buffer;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { downloadUrl: "https://example.supabase.co/signed/abc", backupType: "source" }))
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => contentBytes });
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto-largo"), "agent-1", "http://gw");

      const result = await transport.download("device-1", "snap-1");

      expect(result.backupType).toBe("source");
      expect(Buffer.compare(result.content, Buffer.from(contentBytes))).toBe(0);
      expect(fetchMock).toHaveBeenNthCalledWith(1, "http://gw/v1/devices/device-1/snapshots/snap-1/download-url", {
        headers: { "X-Pairing-Secret": "secreto-largo", "X-Edge-Agent-Id": "agent-1" },
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://example.supabase.co/signed/abc");
    });

    it("lanza si el Gateway devuelve un backupType inválido o ausente", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { downloadUrl: "https://example.supabase.co/signed/abc" }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(transport.download("device-1", "snap-1")).rejects.toThrow(/No se pudo iniciar la descarga/);
    });

    it("lanza si el Gateway no devuelve downloadUrl", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: "no encontrado" }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(transport.download("device-1", "no-existe")).rejects.toThrow("no encontrado");
    });

    it("lanza si la descarga desde la signed URL falla", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { downloadUrl: "https://example.supabase.co/signed/abc", backupType: "source" }))
        .mockResolvedValueOnce({ ok: false });
      global.fetch = fetchMock as unknown as typeof fetch;
      const transport = new GatewaySnapshotTransport(configStoreWithToken("secreto"), "agent-1", "http://gw");

      await expect(transport.download("device-1", "snap-1")).rejects.toThrow(/No se pudo descargar el snapshot/);
    });
  });
});
