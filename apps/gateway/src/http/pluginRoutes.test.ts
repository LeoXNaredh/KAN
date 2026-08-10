import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { PairingPort } from "@kan/core";
import type {
  MintedPluginPackageTicket,
  PluginCatalogEntry,
  PluginDownloadRef,
  PluginPackageTicketClaim,
  PluginPackageTicketPort,
  PluginRegistryPort,
} from "@kan/gateway-core";
import { createPluginRoutes } from "./pluginRoutes";

const MANIFEST = {
  id: "kan-plugin-vision-py",
  version: "0.1.0",
  displayName: "Visión artificial (OpenCV)",
  kind: "device-driver" as const,
  runtime: "python-sidecar" as const,
  permissions: { devices: ["camera-usb"], network: false, filesystem: [] },
};

function fakePairingPort(resolveOwner: PairingPort["resolveOwner"]): PairingPort {
  return {
    generateCode: async () => ({ code: "", expiresAt: "" }),
    claim: async () => undefined,
    resolveOwner,
    getPluginConfig: async () => undefined,
  };
}

function fakeRegistry(overrides: Partial<PluginRegistryPort> = {}): PluginRegistryPort {
  return {
    listCatalog: async (): Promise<PluginCatalogEntry[]> => [{ manifest: MANIFEST, description: "Detecta caras." }],
    getDownloadRef: async (): Promise<PluginDownloadRef | undefined> => ({
      storageObjectPath: "kan-plugin-vision-py/0.1.0.tar.gz",
      manifest: MANIFEST,
    }),
    createSignedDownloadUrl: async () => "https://example.supabase.co/signed/abc",
    ...overrides,
  };
}

function fakeTicketPort(): PluginPackageTicketPort {
  return {
    mint: (ownerId: string, pluginId: string): MintedPluginPackageTicket => ({
      ticket: `${ownerId}:${pluginId}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    consume: (ticket: string): PluginPackageTicketClaim | undefined => {
      const [ownerId, pluginId] = ticket.split(":");
      return ownerId && pluginId ? { ownerId, pluginId } : undefined;
    },
  };
}

function appWith(pairingPort: PairingPort, registry = fakeRegistry(), ticketPort = fakeTicketPort()) {
  const app = express();
  app.use(express.json());
  app.use(createPluginRoutes(pairingPort, registry, ticketPort));
  return app;
}

describe("GET /v1/plugins/catalog", () => {
  it("con un secreto válido, devuelve el catálogo", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .get("/v1/plugins/catalog")
      .set("X-Pairing-Secret", "secreto-largo")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ catalog: [{ manifest: MANIFEST, description: "Detecta caras." }] });
  });

  it("rechaza con 400 si faltan los headers de secreto/edgeAgentId", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app).get("/v1/plugins/catalog");

    expect(response.status).toBe(400);
  });

  it("rechaza con 401 si el secreto no resuelve a ningún pairing", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const response = await request(app)
      .get("/v1/plugins/catalog")
      .set("X-Pairing-Secret", "secreto-invalido")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(401);
  });

  it("rechaza con 500 si resolveOwner() lanza", async () => {
    const app = appWith(fakePairingPort(async () => Promise.reject(new Error("db caída"))));

    const response = await request(app)
      .get("/v1/plugins/catalog")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(500);
  });

  it("rechaza con 429 al superar el rate limit propio", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await request(app)
          .get("/v1/plugins/catalog")
          .set("X-Pairing-Secret", "secreto")
          .set("X-Edge-Agent-Id", "agent-1"),
      );
    }

    expect(responses.slice(0, 10).every((r) => r.status === 401)).toBe(true);
    expect(responses[10].status).toBe(429);
  });
});

describe("POST /v1/plugins/:id/download", () => {
  it("con un secreto válido y un plugin existente, devuelve downloadUrl/expiresAt/manifest", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/plugins/kan-plugin-vision-py/download")
      .set("X-Pairing-Secret", "secreto-largo")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(200);
    expect(response.body.downloadUrl).toBe("https://example.supabase.co/signed/abc");
    expect(response.body.manifest).toEqual(MANIFEST);
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rechaza con 400 si faltan los headers de secreto/edgeAgentId", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app).post("/v1/plugins/kan-plugin-vision-py/download");

    expect(response.status).toBe(400);
  });

  it("rechaza con 401 si el secreto no resuelve a ningún pairing", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const response = await request(app)
      .post("/v1/plugins/kan-plugin-vision-py/download")
      .set("X-Pairing-Secret", "secreto-invalido")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(401);
  });

  it("rechaza con 404 si el plugin no está en el catálogo", async () => {
    const app = appWith(
      fakePairingPort(async () => "user-1"),
      fakeRegistry({ getDownloadRef: async () => undefined }),
    );

    const response = await request(app)
      .post("/v1/plugins/no-existe/download")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(404);
  });

  it("rechaza con 500 si createSignedDownloadUrl() lanza", async () => {
    const app = appWith(
      fakePairingPort(async () => "user-1"),
      fakeRegistry({
        createSignedDownloadUrl: async () => {
          throw new Error("bucket no encontrado");
        },
      }),
    );

    const response = await request(app)
      .post("/v1/plugins/kan-plugin-vision-py/download")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(500);
  });
});
