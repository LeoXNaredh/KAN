import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { PairingPort } from "@kan/core";
import type {
  DeviceSnapshotRecord,
  DeviceSnapshotStorePort,
  DeviceSnapshotTicketClaim,
  DeviceSnapshotTicketPort,
  MintedDeviceSnapshotTicket,
  SignedUploadTarget,
} from "@kan/gateway-core";
import { createSnapshotRoutes } from "./snapshotRoutes";

const RECORD: DeviceSnapshotRecord = {
  id: "snap-1",
  userId: "user-1",
  edgeAgentId: "agent-1",
  deviceId: "device-1",
  deviceName: "Pico del taller",
  deviceKind: "micropython",
  backupType: "source",
  storageObjectPath: "user-1/device-1/snap-1.json",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function fakePairingPort(resolveOwner: PairingPort["resolveOwner"]): PairingPort {
  return {
    generateCode: async () => ({ code: "", expiresAt: "" }),
    claim: async () => undefined,
    resolveOwner,
    getPluginConfig: async () => undefined,
  };
}

function fakeStore(overrides: Partial<DeviceSnapshotStorePort> = {}): DeviceSnapshotStorePort {
  return {
    create: async () => RECORD,
    listByUser: async () => [RECORD],
    get: async () => RECORD,
    delete: async () => {},
    createSignedUploadUrl: async (): Promise<SignedUploadTarget> => ({
      signedUrl: "https://example.supabase.co/upload/abc",
      token: "tok-123",
    }),
    createSignedDownloadUrl: async () => "https://example.supabase.co/signed/abc",
    uploadContent: async () => {},
    downloadContent: async () => Buffer.alloc(0),
    ...overrides,
  };
}

function fakeTicketPort(): DeviceSnapshotTicketPort {
  return {
    mint: (ownerId: string, deviceId: string): MintedDeviceSnapshotTicket => ({
      ticket: `${ownerId}:${deviceId}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    consume: (ticket: string): DeviceSnapshotTicketClaim | undefined => {
      const [ownerId, deviceId] = ticket.split(":");
      return ownerId && deviceId ? { ownerId, deviceId } : undefined;
    },
  };
}

function appWith(pairingPort: PairingPort, store = fakeStore(), ticketPort = fakeTicketPort()) {
  const app = express();
  app.use(express.json());
  app.use(createSnapshotRoutes(pairingPort, store, ticketPort));
  return app;
}

describe("POST /v1/devices/:deviceId/snapshots/upload-url", () => {
  it("con un secreto válido, devuelve signedUrl/token/storageObjectPath", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/upload-url")
      .set("X-Pairing-Secret", "secreto-largo")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ backupType: "source" });

    expect(response.status).toBe(200);
    expect(response.body.signedUrl).toBe("https://example.supabase.co/upload/abc");
    expect(response.body.token).toBe("tok-123");
    expect(response.body.storageObjectPath).toMatch(/^user-1\/device-1\/.+\.json$/);
  });

  it("usa la extensión .bin para backups binarios", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/upload-url")
      .set("X-Pairing-Secret", "secreto-largo")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ backupType: "binary" });

    expect(response.body.storageObjectPath).toMatch(/\.bin$/);
  });

  it("rechaza con 400 si faltan los headers de secreto/edgeAgentId", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app).post("/v1/devices/device-1/snapshots/upload-url").send({ backupType: "source" });

    expect(response.status).toBe(400);
  });

  it("rechaza con 400 si 'backupType' no es válido", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/upload-url")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ backupType: "no-existe" });

    expect(response.status).toBe(400);
  });

  it("rechaza con 401 si el secreto no resuelve a ningún pairing", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/upload-url")
      .set("X-Pairing-Secret", "secreto-invalido")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ backupType: "source" });

    expect(response.status).toBe(401);
  });

  it("rechaza con 500 si createSignedUploadUrl() lanza", async () => {
    const app = appWith(
      fakePairingPort(async () => "user-1"),
      fakeStore({
        createSignedUploadUrl: async () => {
          throw new Error("bucket no encontrado");
        },
      }),
    );

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/upload-url")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ backupType: "source" });

    expect(response.status).toBe(500);
  });
});

describe("POST /v1/devices/:deviceId/snapshots/confirm", () => {
  const validBody = {
    storageObjectPath: "user-1/device-1/snap-1.json",
    backupType: "source",
    deviceKind: "micropython",
    deviceName: "Pico del taller",
  };

  it("con datos válidos, crea el snapshot y devuelve 201", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/confirm")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1")
      .send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.snapshot).toEqual(RECORD);
  });

  it("rechaza con 400 si faltan campos requeridos", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/confirm")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ backupType: "source" });

    expect(response.status).toBe(400);
  });

  it("rechaza con 403 si storageObjectPath no pertenece al owner resuelto", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/confirm")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1")
      .send({ ...validBody, storageObjectPath: "otro-user/device-1/snap-1.json" });

    expect(response.status).toBe(403);
  });

  it("rechaza con 500 si create() lanza", async () => {
    const app = appWith(
      fakePairingPort(async () => "user-1"),
      fakeStore({
        create: async () => {
          throw new Error("columna inválida");
        },
      }),
    );

    const response = await request(app)
      .post("/v1/devices/device-1/snapshots/confirm")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1")
      .send(validBody);

    expect(response.status).toBe(500);
  });
});

describe("GET /v1/devices/:deviceId/snapshots/:id/download-url", () => {
  it("con un snapshot existente del mismo owner/dispositivo, devuelve downloadUrl", async () => {
    const app = appWith(fakePairingPort(async () => "user-1"));

    const response = await request(app)
      .get("/v1/devices/device-1/snapshots/snap-1/download-url")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(200);
    expect(response.body.downloadUrl).toBe("https://example.supabase.co/signed/abc");
    expect(response.body.backupType).toBe("source");
  });

  it("rechaza con 404 si el snapshot no existe", async () => {
    const app = appWith(
      fakePairingPort(async () => "user-1"),
      fakeStore({ get: async () => undefined }),
    );

    const response = await request(app)
      .get("/v1/devices/device-1/snapshots/no-existe/download-url")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(404);
  });

  it("rechaza con 404 si el snapshot pertenece a otro owner", async () => {
    const app = appWith(
      fakePairingPort(async () => "user-2"),
      fakeStore({ get: async () => RECORD }),
    );

    const response = await request(app)
      .get("/v1/devices/device-1/snapshots/snap-1/download-url")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(404);
  });
});
