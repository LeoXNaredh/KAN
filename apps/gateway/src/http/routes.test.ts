import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { AgentGrantPort } from "@kan/core";
import type { DeviceSnapshotRecord, DeviceSnapshotStorePort, EdgeTicketPort, Gateway, LiveVoiceSessionStore } from "@kan/gateway-core";
import type { AuthPort } from "@kan/core";
import { createRoutes, type RateLimitOptions } from "./routes";

const TOKEN = "test-internal-token";

function fakeGateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    listTools: () => [{ name: "read_sensor", description: "...", inputSchema: {} }],
    executeTool: async () => ({ success: true, data: { ok: true } }),
    resolveConfirmation: async () => ({ success: true, data: { ok: true } }),
    listPendingConfirmations: () => [],
    agentRegistry: { list: () => [], setGrantedUserIds: () => {} } as unknown as Gateway["agentRegistry"],
    capabilityRegistry: { list: () => [], resolve: () => undefined } as unknown as Gateway["capabilityRegistry"],
    telemetryHistory: { list: () => [], history: () => [] } as unknown as Gateway["telemetryHistory"],
    auditService: { list: () => [] } as unknown as Gateway["auditService"],
    scheduler: {
      list: () => [],
      schedule: () => "job-1",
      cancel: () => {},
    } as unknown as Gateway["scheduler"],
    alertMonitor: { list: () => [], restore: () => {} } as unknown as Gateway["alertMonitor"],
    ...overrides,
  } as Gateway;
}

function appWith(
  gateway: Gateway,
  rateLimitOptions?: RateLimitOptions,
  authPort?: AuthPort,
  liveVoiceSessionStore?: LiveVoiceSessionStore,
  edgeTicketStore?: EdgeTicketPort,
  agentGrantStore?: AgentGrantPort,
  deviceSnapshotStore?: DeviceSnapshotStorePort,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createRoutes(
      gateway,
      TOKEN,
      rateLimitOptions,
      authPort,
      liveVoiceSessionStore,
      edgeTicketStore,
      agentGrantStore,
      deviceSnapshotStore,
    ),
  );
  return app;
}

const SNAPSHOT_RECORD: DeviceSnapshotRecord = {
  id: "snap-1",
  userId: "user-1",
  edgeAgentId: "agent-1",
  deviceId: "device-1",
  deviceKind: "micropython",
  backupType: "source",
  storageObjectPath: "user-1/device-1/snap-1.json",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function fakeDeviceSnapshotStore(overrides: Partial<DeviceSnapshotStorePort> = {}): DeviceSnapshotStorePort {
  return {
    create: async () => SNAPSHOT_RECORD,
    listByUser: async () => [SNAPSHOT_RECORD],
    get: async () => SNAPSHOT_RECORD,
    delete: async () => {},
    createSignedUploadUrl: async () => ({ signedUrl: "", token: "" }),
    createSignedDownloadUrl: async () => "",
    uploadContent: async () => {},
    downloadContent: async () => Buffer.alloc(0),
    ...overrides,
  };
}

function fakeAgentGrantStore(overrides: Partial<AgentGrantPort> = {}): AgentGrantPort {
  return {
    grant: async () => ({ userId: "invited-1", email: "invited@example.com" }),
    revoke: async () => undefined,
    list: async () => [],
    listAll: async () => [],
    ...overrides,
  };
}

function fakeEdgeTicketStore(mint: (ownerId: string) => { ticket: string; expiresAt: string }): EdgeTicketPort {
  return { mint, consume: () => undefined } as unknown as EdgeTicketPort;
}

function fakeAuthPort(getCurrentUser: AuthPort["getCurrentUser"]): AuthPort {
  return { getCurrentUser } as AuthPort;
}

function fakeLiveVoiceSessionStore(
  register: (config: Parameters<LiveVoiceSessionStore["register"]>[0]) => string,
): LiveVoiceSessionStore {
  return {
    register: (config: Parameters<LiveVoiceSessionStore["register"]>[0]) => ({
      sessionId: register(config),
      expiresAt: "2026-01-01T00:05:00.000Z",
    }),
    claim: () => undefined,
  } as unknown as LiveVoiceSessionStore;
}

describe("Gateway HTTP routes", () => {
  it("rechaza requests sin token con 401", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app).get("/v1/tools");
    expect(response.status).toBe(401);
  });

  it("rechaza requests con token incorrecto con 401", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app).get("/v1/tools").set("Authorization", "Bearer token-incorrecto");
    expect(response.status).toBe(401);
  });

  it("GET /v1/tools devuelve el catálogo con token válido", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tools: [{ name: "read_sensor", description: "...", inputSchema: {} }] });
  });

  it("POST /v1/tools/:name/execute pasa el nombre y los args al Gateway", async () => {
    let received: { name: string; args: unknown } | undefined;
    const gateway = fakeGateway({
      executeTool: async (name: string, args: unknown) => {
        received = { name, args };
        return { success: true };
      },
    });
    const app = appWith(gateway);

    const response = await request(app)
      .post("/v1/tools/read_sensor/execute")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ args: { foo: "bar" } });

    expect(response.status).toBe(200);
    expect(received).toEqual({ name: "read_sensor", args: { foo: "bar" } });
  });

  it("POST /v1/tools/:name/execute con body vacío no lanza — usa {} por defecto", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app)
      .post("/v1/tools/read_sensor/execute")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send();
    expect(response.status).toBe(200);
  });

  describe("GET /v1/capabilities — catálogo agrupado por dispositivo (constructor de secuencias)", () => {
    it("agrupa las capabilities por deviceId", async () => {
      const gateway = fakeGateway({
        capabilityRegistry: {
          list: () => [
            {
              ref: "c_agent1a_dev1_read_temp",
              edgeAgentId: "agent1abc",
              deviceId: "dev1",
              deviceName: "Sensor de invernadero",
              capability: { name: "read_temp", description: "Lee la temperatura", severity: "read-only", supportsDryRun: false, inputSchema: {} },
            },
            {
              ref: "c_agent1a_dev1_toggle_fan",
              edgeAgentId: "agent1abc",
              deviceId: "dev1",
              deviceName: "Sensor de invernadero",
              capability: { name: "toggle_fan", description: "Prende/apaga el ventilador", severity: "reversible", supportsDryRun: false, inputSchema: { type: "object", properties: { on: { type: "boolean" } } } },
            },
            {
              ref: "c_agent2b_dev2_read_level",
              edgeAgentId: "agent2bcd",
              deviceId: "dev2",
              deviceName: "Tanque de agua",
              capability: { name: "read_level", description: "Lee el nivel", severity: "read-only", supportsDryRun: false },
            },
          ],
        } as unknown as Gateway["capabilityRegistry"],
      });
      const app = appWith(gateway);

      const response = await request(app).get("/v1/capabilities").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(200);
      expect(response.body.devices).toHaveLength(2);
      const invernadero = response.body.devices.find((d: { deviceId: string }) => d.deviceId === "dev1");
      expect(invernadero.deviceName).toBe("Sensor de invernadero");
      expect(invernadero.capabilities).toHaveLength(2);
      expect(invernadero.capabilities[0]).toEqual({
        ref: "c_agent1a_dev1_read_temp",
        name: "read_temp",
        description: "Lee la temperatura",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {},
      });
      const tanque = response.body.devices.find((d: { deviceId: string }) => d.deviceId === "dev2");
      expect(tanque.capabilities[0].inputSchema).toEqual({});
    });

    it("rechaza requests sin token con 401", async () => {
      const app = appWith(fakeGateway());
      const response = await request(app).get("/v1/capabilities");
      expect(response.status).toBe(401);
    });

    it("pasa req.userId al Gateway para el filtro por owner", async () => {
      let received: string | undefined;
      const gateway = fakeGateway({
        capabilityRegistry: {
          list: (userId?: string) => {
            received = userId;
            return [];
          },
        } as unknown as Gateway["capabilityRegistry"],
      });
      const authPort = fakeAuthPort(async () => ({ userId: "user-1", email: "a@b.com" }));
      const app = appWith(gateway, undefined, authPort);

      await request(app).get("/v1/capabilities").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "valid-jwt");

      expect(received).toBe("user-1");
    });
  });

  describe("POST /v1/telemetry/poll — lectura en vivo de sensores (dashboard)", () => {
    it("rechaza sin token con 401", async () => {
      const app = appWith(fakeGateway());
      const response = await request(app).post("/v1/telemetry/poll").send({ refs: ["c_1_read_temp"] });
      expect(response.status).toBe(401);
    });

    it("rechaza sin 'refs' (o vacío/no-array) con 400, sin llamar a executeTool", async () => {
      let called = false;
      const gateway = fakeGateway({ executeTool: async () => { called = true; return { success: true }; } });
      const app = appWith(gateway);

      const empty = await request(app).post("/v1/telemetry/poll").set("Authorization", `Bearer ${TOKEN}`).send({ refs: [] });
      expect(empty.status).toBe(400);

      const missing = await request(app).post("/v1/telemetry/poll").set("Authorization", `Bearer ${TOKEN}`).send({});
      expect(missing.status).toBe(400);

      const notStrings = await request(app).post("/v1/telemetry/poll").set("Authorization", `Bearer ${TOKEN}`).send({ refs: [1, 2] });
      expect(notStrings.status).toBe(400);

      expect(called).toBe(false);
    });

    it("rechaza más de 30 refs con 400, sin ejecutar ninguno", async () => {
      let called = false;
      const gateway = fakeGateway({ executeTool: async () => { called = true; return { success: true }; } });
      const app = appWith(gateway);

      const tooMany = Array.from({ length: 31 }, (_, i) => `c_ref_${i}`);
      const atLimit = Array.from({ length: 30 }, (_, i) => `c_ref_${i}`);

      const overLimit = await request(app).post("/v1/telemetry/poll").set("Authorization", `Bearer ${TOKEN}`).send({ refs: tooMany });
      expect(overLimit.status).toBe(400);
      expect(overLimit.body.error).toMatch(/30/);
      expect(called).toBe(false);

      const withinLimit = await request(app).post("/v1/telemetry/poll").set("Authorization", `Bearer ${TOKEN}`).send({ refs: atLimit });
      expect(withinLimit.status).toBe(200);
    });

    it("un ref que no es read-only se rechaza SIN ejecutarlo — gate de seguridad no negociable", async () => {
      let executed = false;
      const gateway = fakeGateway({
        capabilityRegistry: {
          resolve: (ref: string) => (ref === "c_toggle_motor" ? { capability: { severity: "irreversible-material" } } : undefined),
        } as unknown as Gateway["capabilityRegistry"],
        executeTool: async () => {
          executed = true;
          return { success: true };
        },
      });
      const app = appWith(gateway);

      const response = await request(app)
        .post("/v1/telemetry/poll")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ refs: ["c_toggle_motor"] });

      expect(response.status).toBe(200);
      expect(response.body.readings).toEqual([{ ref: "c_toggle_motor", success: false, error: "No es una capability de lectura válida." }]);
      expect(executed).toBe(false);
    });

    it("un ref read-only se ejecuta y devuelve el valor numérico extraído", async () => {
      const gateway = fakeGateway({
        capabilityRegistry: {
          resolve: (ref: string) => (ref === "c_read_temp" ? { capability: { severity: "read-only" } } : undefined),
        } as unknown as Gateway["capabilityRegistry"],
        executeTool: async (name: string) => (name === "c_read_temp" ? { success: true, data: { temperatureC: 23.4 } } : { success: false }),
      });
      const app = appWith(gateway);

      const response = await request(app)
        .post("/v1/telemetry/poll")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ refs: ["c_read_temp"] });

      expect(response.status).toBe(200);
      expect(response.body.readings).toEqual([{ ref: "c_read_temp", success: true, value: 23.4, error: undefined }]);
    });

    it("varios refs se resuelven en paralelo, cada uno con su propio resultado", async () => {
      const gateway = fakeGateway({
        capabilityRegistry: {
          resolve: () => ({ capability: { severity: "read-only" } }),
        } as unknown as Gateway["capabilityRegistry"],
        executeTool: async (name: string) => ({ success: true, data: { value: name === "c_a" ? 1 : 2 } }),
      });
      const app = appWith(gateway);

      const response = await request(app)
        .post("/v1/telemetry/poll")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ refs: ["c_a", "c_b"] });

      expect(response.body.readings).toEqual([
        { ref: "c_a", success: true, value: 1, error: undefined },
        { ref: "c_b", success: true, value: 2, error: undefined },
      ]);
    });
  });

  describe("GET /v1/telemetry — catálogo de sensores conocidos (conectados o no)", () => {
    it("rechaza sin token con 401", async () => {
      const app = appWith(fakeGateway());
      const response = await request(app).get("/v1/telemetry");
      expect(response.status).toBe(401);
    });

    it("marca 'connected' cruzando contra capabilityRegistry.resolve()", async () => {
      const gateway = fakeGateway({
        telemetryHistory: {
          list: () => [
            { ref: "c_online", edgeAgentId: "a1", deviceName: "D1", description: "Lee X", latest: { value: 1, at: "2026-01-01T00:00:00.000Z" } },
            { ref: "c_offline", edgeAgentId: "a1", deviceName: "D1", description: "Lee Y", latest: { value: 2, at: "2026-01-01T00:00:00.000Z" } },
          ],
        } as unknown as Gateway["telemetryHistory"],
        capabilityRegistry: {
          resolve: (ref: string) => (ref === "c_online" ? {} : undefined),
        } as unknown as Gateway["capabilityRegistry"],
      });
      const app = appWith(gateway);

      const response = await request(app).get("/v1/telemetry").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(200);
      const byRef = Object.fromEntries(response.body.sensors.map((s: { ref: string; connected: boolean }) => [s.ref, s.connected]));
      expect(byRef).toEqual({ c_online: true, c_offline: false });
    });
  });

  describe("GET /v1/telemetry/:ref/history — historial para el gráfico", () => {
    it("rechaza sin token con 401", async () => {
      const app = appWith(fakeGateway());
      const response = await request(app).get("/v1/telemetry/c_read_temp/history");
      expect(response.status).toBe(401);
    });

    it("pasa el ref y el userId a telemetryHistory.history()", async () => {
      let received: { ref: string; userId: string | undefined } | undefined;
      const gateway = fakeGateway({
        telemetryHistory: {
          history: (ref: string, userId?: string) => {
            received = { ref, userId };
            return [{ value: 23.4, at: "2026-01-01T00:00:00.000Z" }];
          },
        } as unknown as Gateway["telemetryHistory"],
      });
      const app = appWith(gateway);

      const response = await request(app).get("/v1/telemetry/c_read_temp/history").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(200);
      expect(response.body.readings).toEqual([{ value: 23.4, at: "2026-01-01T00:00:00.000Z" }]);
      expect(received?.ref).toBe("c_read_temp");
    });
  });

  describe("Acceso multi-usuario — /v1/agents/:edgeAgentId/grants", () => {
    describe("POST — invitar", () => {
      it("sin agentGrantStore configurado, responde 501", async () => {
        const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, undefined);
        const response = await request(app)
          .post("/v1/agents/agent-1/grants")
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ email: "nuevo@example.com" });
        expect(response.status).toBe(501);
      });

      it("rechaza sin sesión (sin req.userId) con 401", async () => {
        const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, fakeAgentGrantStore());
        const response = await request(app)
          .post("/v1/agents/agent-1/grants")
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ email: "nuevo@example.com" });
        expect(response.status).toBe(401);
      });

      it("rechaza sin 'email' con 400", async () => {
        const authPort = fakeAuthPort(async () => ({ userId: "owner-1", email: "owner@example.com" }));
        const app = appWith(fakeGateway(), undefined, authPort, undefined, undefined, fakeAgentGrantStore());
        const response = await request(app)
          .post("/v1/agents/agent-1/grants")
          .set("Authorization", `Bearer ${TOKEN}`)
          .set("X-User-Token", "valid-jwt")
          .send({});
        expect(response.status).toBe(400);
      });

      it("con email válido, invita y actualiza el cache de AgentRegistry al toque (201)", async () => {
        const authPort = fakeAuthPort(async () => ({ userId: "owner-1", email: "owner@example.com" }));
        let receivedGrantArgs: unknown;
        let receivedSetGrantedUserIds: unknown;
        const grantStore = fakeAgentGrantStore({
          grant: async (edgeAgentId, ownerId, email) => {
            receivedGrantArgs = { edgeAgentId, ownerId, email };
            return { userId: "invited-1", email };
          },
          list: async () => [{ userId: "invited-1", email: "nuevo@example.com" }],
        });
        const gateway = fakeGateway({
          agentRegistry: {
            list: () => [],
            setGrantedUserIds: (edgeAgentId: string, userIds: string[]) => {
              receivedSetGrantedUserIds = { edgeAgentId, userIds };
            },
          } as unknown as Gateway["agentRegistry"],
        });
        const app = appWith(gateway, undefined, authPort, undefined, undefined, grantStore);

        const response = await request(app)
          .post("/v1/agents/agent-1/grants")
          .set("Authorization", `Bearer ${TOKEN}`)
          .set("X-User-Token", "valid-jwt")
          .send({ email: "nuevo@example.com" });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ userId: "invited-1", email: "nuevo@example.com" });
        expect(receivedGrantArgs).toEqual({ edgeAgentId: "agent-1", ownerId: "owner-1", email: "nuevo@example.com" });
        expect(receivedSetGrantedUserIds).toEqual({ edgeAgentId: "agent-1", userIds: ["invited-1"] });
      });

      it("si el store devuelve { error }, responde 400 con ese mensaje", async () => {
        const authPort = fakeAuthPort(async () => ({ userId: "owner-1", email: "owner@example.com" }));
        const grantStore = fakeAgentGrantStore({
          grant: async () => ({ error: "No encontramos ningún usuario con ese email." }),
        });
        const app = appWith(fakeGateway(), undefined, authPort, undefined, undefined, grantStore);

        const response = await request(app)
          .post("/v1/agents/agent-1/grants")
          .set("Authorization", `Bearer ${TOKEN}`)
          .set("X-User-Token", "valid-jwt")
          .send({ email: "nadie@example.com" });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "No encontramos ningún usuario con ese email." });
      });
    });

    describe("GET — listar", () => {
      it("pasa edgeAgentId y el userId (dueño) al store", async () => {
        const authPort = fakeAuthPort(async () => ({ userId: "owner-1", email: "owner@example.com" }));
        let received: { edgeAgentId: string; ownerId: string } | undefined;
        const grantStore = fakeAgentGrantStore({
          list: async (edgeAgentId, ownerId) => {
            received = { edgeAgentId, ownerId };
            return [{ userId: "invited-1", email: "nuevo@example.com" }];
          },
        });
        const app = appWith(fakeGateway(), undefined, authPort, undefined, undefined, grantStore);

        const response = await request(app)
          .get("/v1/agents/agent-1/grants")
          .set("Authorization", `Bearer ${TOKEN}`)
          .set("X-User-Token", "valid-jwt");

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ grants: [{ userId: "invited-1", email: "nuevo@example.com" }] });
        expect(received).toEqual({ edgeAgentId: "agent-1", ownerId: "owner-1" });
      });
    });

    describe("DELETE — revocar", () => {
      it("pasa edgeAgentId, el ownerId (quien pide) y el userId a revocar — efecto inmediato en el cache (204)", async () => {
        const authPort = fakeAuthPort(async () => ({ userId: "owner-1", email: "owner@example.com" }));
        let receivedRevokeArgs: unknown;
        let receivedSetGrantedUserIds: unknown;
        const grantStore = fakeAgentGrantStore({
          revoke: async (edgeAgentId, ownerId, userId) => {
            receivedRevokeArgs = { edgeAgentId, ownerId, userId };
          },
          list: async () => [],
        });
        const gateway = fakeGateway({
          agentRegistry: {
            list: () => [],
            setGrantedUserIds: (edgeAgentId: string, userIds: string[]) => {
              receivedSetGrantedUserIds = { edgeAgentId, userIds };
            },
          } as unknown as Gateway["agentRegistry"],
        });
        const app = appWith(gateway, undefined, authPort, undefined, undefined, grantStore);

        const response = await request(app)
          .delete("/v1/agents/agent-1/grants/invited-1")
          .set("Authorization", `Bearer ${TOKEN}`)
          .set("X-User-Token", "valid-jwt");

        expect(response.status).toBe(204);
        expect(receivedRevokeArgs).toEqual({ edgeAgentId: "agent-1", ownerId: "owner-1", userId: "invited-1" });
        expect(receivedSetGrantedUserIds).toEqual({ edgeAgentId: "agent-1", userIds: [] });
      });
    });
  });

  describe("GET /v1/confirmations — bandeja de confirmaciones pendientes", () => {
    it("expone el listado del Gateway", async () => {
      const gateway = fakeGateway({
        listPendingConfirmations: () => [{ confirmationId: "conf-1", deviceId: "d1", capabilityName: "toggle_motor", input: {}, severity: "irreversible-material" }],
      });
      const app = appWith(gateway);

      const response = await request(app).get("/v1/confirmations").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        confirmations: [{ confirmationId: "conf-1", deviceId: "d1", capabilityName: "toggle_motor", input: {}, severity: "irreversible-material" }],
      });
    });

    it("pasa req.userId al Gateway para el filtro por owner", async () => {
      let received: string | undefined;
      const gateway = fakeGateway({
        listPendingConfirmations: (userId?: string) => {
          received = userId;
          return [];
        },
      });
      const authPort = fakeAuthPort(async () => ({ userId: "user-1", email: "a@b.com" }));
      const app = appWith(gateway, undefined, authPort);

      await request(app).get("/v1/confirmations").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "valid-jwt");

      expect(received).toBe("user-1");
    });
  });

  describe("POST /v1/confirmations/:id/resolve (ADR-059)", () => {
    it("pasa el id, approved y el userId al Gateway", async () => {
      let received: { id: string; approved: boolean; userId: string | undefined } | undefined;
      const gateway = fakeGateway({
        resolveConfirmation: async (id: string, approved: boolean, userId?: string) => {
          received = { id, approved, userId };
          return { success: true, data: { moved: true } };
        },
      });
      const app = appWith(gateway);

      const response = await request(app)
        .post("/v1/confirmations/conf-1/resolve")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ approved: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { moved: true } });
      expect(received).toEqual({ id: "conf-1", approved: true, userId: undefined });
    });

    it("rechaza con 400 si falta 'approved' o no es boolean", async () => {
      const app = appWith(fakeGateway());

      const response = await request(app).post("/v1/confirmations/conf-1/resolve").set("Authorization", `Bearer ${TOKEN}`).send({});

      expect(response.status).toBe(400);
    });

    it("responde 404 si el Gateway no encuentra la confirmación (expirada/desconocida/Gateway reiniciado)", async () => {
      const gateway = fakeGateway({ resolveConfirmation: async () => undefined });
      const app = appWith(gateway);

      const response = await request(app)
        .post("/v1/confirmations/conf-1/resolve")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ approved: false });

      expect(response.status).toBe(404);
    });
  });

  it("GET /v1/agents expone el listado del Agent Registry", async () => {
    const gateway = fakeGateway({
      agentRegistry: { list: () => [{ edgeAgentId: "agent-1" }] } as unknown as Gateway["agentRegistry"],
    });
    const app = appWith(gateway);
    const response = await request(app).get("/v1/agents").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.body).toEqual({ agents: [{ edgeAgentId: "agent-1" }] });
  });

  it("GET /v1/audit expone el listado del Audit Service", async () => {
    const gateway = fakeGateway({
      auditService: { list: () => [{ id: "1" }] } as unknown as Gateway["auditService"],
    });
    const app = appWith(gateway);
    const response = await request(app).get("/v1/audit").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.body).toEqual({ entries: [{ id: "1" }] });
  });

  it("GET /v1/jobs expone el listado del Scheduler", async () => {
    const gateway = fakeGateway({
      scheduler: { list: () => [{ id: "job-1" }] } as unknown as Gateway["scheduler"],
    });
    const app = appWith(gateway);
    const response = await request(app).get("/v1/jobs").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.body).toEqual({ jobs: [{ id: "job-1" }] });
  });

  describe("GET /v1/jobs — filtrado por owner (fix de auditoría de backend)", () => {
    it("solo devuelve los jobs del usuario y los que no tienen createdBy (legacy)", async () => {
      const gateway = fakeGateway({
        scheduler: {
          list: () => [
            { id: "job-mio", createdBy: "user-1" },
            { id: "job-ajeno", createdBy: "user-otro" },
            { id: "job-legacy" },
          ],
        } as unknown as Gateway["scheduler"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      const response = await request(app)
        .get("/v1/jobs")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(200);
      expect(response.body.jobs.map((job: { id: string }) => job.id).sort()).toEqual(["job-legacy", "job-mio"]);
    });

    it("sin sesión resuelta, solo ve los jobs legacy sin createdBy (retrocompatible)", async () => {
      const gateway = fakeGateway({
        scheduler: {
          list: () => [{ id: "job-de-alguien", createdBy: "user-1" }, { id: "job-legacy" }],
        } as unknown as Gateway["scheduler"],
      });
      const app = appWith(gateway);

      const response = await request(app).get("/v1/jobs").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.body).toEqual({ jobs: [{ id: "job-legacy" }] });
    });
  });

  describe("POST /v1/jobs — requiere sesión activa (fix de auditoría de backend)", () => {
    it("rechaza con 401 si req.userId no está resuelto (sin X-User-Token)", async () => {
      const app = appWith(fakeGateway());
      const response = await request(app)
        .post("/v1/jobs")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ steps: [{ capabilityRef: "x" }], cron: "0 8 * * *" });

      expect(response.status).toBe(401);
    });
  });

  it("POST /v1/jobs rechaza sin steps", async () => {
    const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));
    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", "jwt-valido")
      .send({ cron: "0 8 * * *" });
    expect(response.status).toBe(400);
  });

  it("POST /v1/jobs rechaza un step sin capabilityRef", async () => {
    const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));
    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", "jwt-valido")
      .send({ steps: [{ input: {} }], cron: "0 8 * * *" });
    expect(response.status).toBe(400);
  });

  it("POST /v1/jobs delega en scheduler.schedule() con steps (posible >1, 'acciones combinadas') y devuelve el jobId", async () => {
    let received: unknown;
    const gateway = fakeGateway({
      scheduler: {
        list: () => [],
        schedule: (job: unknown) => {
          received = job;
          return "job-42";
        },
        cancel: () => {},
      } as unknown as Gateway["scheduler"],
    });
    const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", "jwt-valido")
      .send({
        steps: [
          { capabilityRef: "riego.abrir_valvula", input: {} },
          { capabilityRef: "riego.cerrar_valvula", input: {} },
        ],
        notification: { title: "Riego listo", body: "Se regó el jardín." },
        cron: "0 8 * * *",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ jobId: "job-42" });
    expect(received).toEqual({
      steps: [
        { capabilityRef: "riego.abrir_valvula", input: {} },
        { capabilityRef: "riego.cerrar_valvula", input: {} },
      ],
      notification: { title: "Riego listo", body: "Se regó el jardín." },
      cron: "0 8 * * *",
      runAt: undefined,
      createdBy: "user-1",
    });
  });

  it("POST /v1/jobs traduce un error de validación del scheduler a 400", async () => {
    const gateway = fakeGateway({
      scheduler: {
        list: () => [],
        schedule: () => {
          throw new Error("Expresión cron inválida: nope");
        },
        cancel: () => {},
      } as unknown as Gateway["scheduler"],
    });
    const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", "jwt-valido")
      .send({ steps: [{ capabilityRef: "x" }], cron: "nope" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Expresión cron inválida: nope" });
  });

  it("rechaza con 429 al superar el límite de requests configurado (docs/16 P6, ADR-025)", async () => {
    const app = appWith(fakeGateway(), { windowMs: 60_000, max: 2 });

    const first = await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);
    const second = await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);
    const third = await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it("el rate limit es por usuario (X-User-Token), no compartido por IP (fix de auditoría de backend #4)", async () => {
    const app = appWith(fakeGateway(), { windowMs: 60_000, max: 2 });
    const jwtFor = (userId: string) =>
      `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(
        JSON.stringify({ sub: userId }),
      ).toString("base64url")}.firma`;

    // Usuario A gasta su presupuesto de 2 (mismo origen/IP que usuario B, vía supertest).
    await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", jwtFor("user-a"));
    await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", jwtFor("user-a"));
    const userAThirdRequest = await request(app)
      .get("/v1/tools")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", jwtFor("user-a"));

    // Usuario B, mismo origen, todavía tiene su propio presupuesto intacto.
    const userBFirstRequest = await request(app)
      .get("/v1/tools")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", jwtFor("user-b"));

    expect(userAThirdRequest.status).toBe(429);
    expect(userBFirstRequest.status).toBe(200);
  });

  it("DELETE /v1/jobs/:id delega en scheduler.cancel()", async () => {
    let cancelledId: string | undefined;
    const gateway = fakeGateway({
      scheduler: {
        list: () => [],
        schedule: () => "job-1",
        cancel: (id: string) => {
          cancelledId = id;
        },
      } as unknown as Gateway["scheduler"],
    });
    const app = appWith(gateway);

    const response = await request(app).delete("/v1/jobs/job-1").set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(204);
    expect(cancelledId).toBe("job-1");
  });

  describe("DELETE /v1/jobs/:id — autorización por owner (fix de auditoría de backend)", () => {
    it("rechaza con 403 cuando el job tiene createdBy y no coincide con el usuario del request", async () => {
      let cancelled = false;
      let recorded: unknown;
      const gateway = fakeGateway({
        scheduler: {
          list: () => [{ id: "job-1", createdBy: "user-owner" }],
          cancel: () => {
            cancelled = true;
          },
        } as unknown as Gateway["scheduler"],
        auditService: {
          list: () => [],
          record: (entry: unknown) => {
            recorded = entry;
          },
        } as unknown as Gateway["auditService"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-otro", email: "" })));

      const response = await request(app)
        .delete("/v1/jobs/job-1")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(403);
      expect(cancelled).toBe(false);
      expect(recorded).toMatchObject({ actor: "user", action: "job.cancel.denied", subject: "job-1" });
    });

    it("permite cancelar cuando el job tiene createdBy y sí coincide con el usuario del request", async () => {
      let cancelledId: string | undefined;
      const gateway = fakeGateway({
        scheduler: {
          list: () => [{ id: "job-1", createdBy: "user-1" }],
          cancel: (id: string) => {
            cancelledId = id;
          },
        } as unknown as Gateway["scheduler"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      const response = await request(app)
        .delete("/v1/jobs/job-1")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(204);
      expect(cancelledId).toBe("job-1");
    });

    it("permite cancelar un job sin createdBy (retrocompatible) sin importar quién lo pida", async () => {
      let cancelledId: string | undefined;
      const gateway = fakeGateway({
        scheduler: {
          list: () => [{ id: "job-1" }],
          cancel: (id: string) => {
            cancelledId = id;
          },
        } as unknown as Gateway["scheduler"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "cualquier-usuario", email: "" })));

      const response = await request(app)
        .delete("/v1/jobs/job-1")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(204);
      expect(cancelledId).toBe("job-1");
    });
  });

  it("sin authPort configurado (retrocompatibilidad), las rutas existentes funcionan igual que siempre", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
  });

  it("con authPort configurado pero sin X-User-Token, las rutas existentes no se ven afectadas", async () => {
    const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "no-debería-llamarse", email: "" })));
    const response = await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
  });

  it("GET /v1/whoami sin X-User-Token devuelve userId/email null", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app).get("/v1/whoami").set("Authorization", `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: null, email: null });
  });

  it("GET /v1/whoami con X-User-Token válido refleja la identidad verificada", async () => {
    const app = appWith(
      fakeGateway(),
      undefined,
      fakeAuthPort(async () => ({ userId: "user-1", email: "gio@example.com" })),
    );
    const response = await request(app)
      .get("/v1/whoami")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", "jwt-valido");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: "user-1", email: "gio@example.com" });
  });

  it("con X-User-Token inválido, rechaza con 401 aunque el token interno sea correcto", async () => {
    const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => undefined));
    const response = await request(app)
      .get("/v1/tools")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("X-User-Token", "jwt-invalido");
    expect(response.status).toBe(401);
  });

  describe("propagación de req.userId a Gateway (docs/19 P2, incremento 4)", () => {
    it("GET /v1/tools pasa el userId verificado a gateway.listTools()", async () => {
      let received: string | undefined;
      const gateway = fakeGateway({
        listTools: (requestingUserId?: string) => {
          received = requestingUserId;
          return [];
        },
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "jwt-valido");

      expect(received).toBe("user-1");
    });

    it("GET /v1/tools sin X-User-Token pasa userId undefined (retrocompatible)", async () => {
      let received: string | undefined = "no-debería-quedar-esto";
      const gateway = fakeGateway({
        listTools: (requestingUserId?: string) => {
          received = requestingUserId;
          return [];
        },
      });
      const app = appWith(gateway);

      await request(app).get("/v1/tools").set("Authorization", `Bearer ${TOKEN}`);

      expect(received).toBeUndefined();
    });

    it("POST /v1/tools/:name/execute pasa el userId verificado a gateway.executeTool()", async () => {
      let received: string | undefined;
      const gateway = fakeGateway({
        executeTool: async (_name: string, _args: unknown, requestingUserId?: string) => {
          received = requestingUserId;
          return { success: true };
        },
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      await request(app)
        .post("/v1/tools/read_sensor/execute")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido")
        .send();

      expect(received).toBe("user-1");
    });

    it("GET /v1/agents pasa el userId verificado a agentRegistry.list()", async () => {
      let received: string | undefined;
      const gateway = fakeGateway({
        agentRegistry: {
          list: (requestingUserId?: string) => {
            received = requestingUserId;
            return [];
          },
        } as unknown as Gateway["agentRegistry"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      await request(app).get("/v1/agents").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "jwt-valido");

      expect(received).toBe("user-1");
    });

    it("GET /v1/audit pasa el userId verificado a auditService.list() (docs/19 P2, incremento 5)", async () => {
      let received: { userId?: string } | undefined;
      const gateway = fakeGateway({
        auditService: {
          list: (filter?: { userId?: string }) => {
            received = filter;
            return [];
          },
        } as unknown as Gateway["auditService"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      await request(app).get("/v1/audit").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "jwt-valido");

      expect(received).toEqual({ userId: "user-1" });
    });

    it("POST /v1/jobs pasa el userId verificado como createdBy del job (P7)", async () => {
      let received: unknown;
      const gateway = fakeGateway({
        scheduler: {
          list: () => [],
          schedule: (job: unknown) => {
            received = job;
            return "job-1";
          },
          cancel: () => {},
        } as unknown as Gateway["scheduler"],
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      await request(app)
        .post("/v1/jobs")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido")
        .send({ steps: [{ capabilityRef: "x" }], runAt: "2026-01-01T00:00:00.000Z" });

      expect((received as { createdBy?: string })?.createdBy).toBe("user-1");
    });

    it("GET /v1/audit sin X-User-Token pasa userId undefined (retrocompatible)", async () => {
      let received: { userId?: string } | undefined;
      const gateway = fakeGateway({
        auditService: {
          list: (filter?: { userId?: string }) => {
            received = filter;
            return [];
          },
        } as unknown as Gateway["auditService"],
      });
      const app = appWith(gateway);

      await request(app).get("/v1/audit").set("Authorization", `Bearer ${TOKEN}`);

      expect(received).toEqual({ userId: undefined });
    });
  });

  describe("POST /v1/live-sessions (ADR-044)", () => {
    it("sin liveVoiceSessionStore configurado, responde 501 (GEMINI_API_KEY ausente)", async () => {
      const app = appWith(fakeGateway());

      const response = await request(app)
        .post("/v1/live-sessions")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ model: "gemini-3.1-flash-live-preview", systemPrompt: "sé breve" });

      expect(response.status).toBe(501);
    });

    it("rechaza sin 'model' o sin 'systemPrompt'", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, fakeLiveVoiceSessionStore(() => "s1"));

      const response = await request(app)
        .post("/v1/live-sessions")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ model: "gemini-3.1-flash-live-preview" });

      expect(response.status).toBe(400);
    });

    it("registra la sesión y devuelve el sessionId", async () => {
      let registeredWith: unknown;
      const app = appWith(
        fakeGateway(),
        undefined,
        undefined,
        fakeLiveVoiceSessionStore((config) => {
          registeredWith = config;
          return "session-abc";
        }),
      );

      const response = await request(app)
        .post("/v1/live-sessions")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ model: "gemini-3.1-flash-live-preview", systemPrompt: "sé breve", tools: [{ name: "read_sensor" }] });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ sessionId: "session-abc", expiresAt: "2026-01-01T00:05:00.000Z" });
      expect(registeredWith).toEqual({
        model: "gemini-3.1-flash-live-preview",
        systemPrompt: "sé breve",
        tools: [{ name: "read_sensor" }],
      });
    });

    it("sin token interno, rechaza con 401 como el resto de /v1/*", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, fakeLiveVoiceSessionStore(() => "s1"));

      const response = await request(app)
        .post("/v1/live-sessions")
        .send({ model: "gemini-3.1-flash-live-preview", systemPrompt: "sé breve" });

      expect(response.status).toBe(401);
    });
  });

  describe("POST /v1/edge-tickets (docs/19 continuación — Simulador en el navegador)", () => {
    it("sin edgeTicketStore configurado, responde 501", async () => {
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      const response = await request(app)
        .post("/v1/edge-tickets")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(501);
    });

    it("sin sesión (sin X-User-Token), responde 401 aunque haya edgeTicketStore", async () => {
      const store = fakeEdgeTicketStore(() => ({ ticket: "t1", expiresAt: "2026-01-01T00:01:00.000Z" }));
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        store,
      );

      const response = await request(app).post("/v1/edge-tickets").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(401);
    });

    it("con sesión válida, mintea un ticket a nombre del usuario y lo devuelve", async () => {
      let mintedFor: string | undefined;
      const store = fakeEdgeTicketStore((ownerId) => {
        mintedFor = ownerId;
        return { ticket: "ticket-abc", expiresAt: "2026-01-01T00:01:00.000Z" };
      });
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        store,
      );

      const response = await request(app)
        .post("/v1/edge-tickets")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ ticket: "ticket-abc", expiresAt: "2026-01-01T00:01:00.000Z" });
      expect(mintedFor).toBe("user-1");
    });
  });

  describe("GET /v1/snapshots (docs/06, backup/restore de proyecto)", () => {
    it("sin deviceSnapshotStore configurado, devuelve lista vacía", async () => {
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      const response = await request(app).get("/v1/snapshots").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ snapshots: [] });
    });

    it("sin sesión de usuario, devuelve lista vacía aunque el store esté configurado", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, undefined, fakeDeviceSnapshotStore());

      const response = await request(app).get("/v1/snapshots").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.body).toEqual({ snapshots: [] });
    });

    it("filtra por el userId verificado", async () => {
      let receivedUserId: string | undefined;
      const store = fakeDeviceSnapshotStore({
        listByUser: async (userId) => {
          receivedUserId = userId;
          return [SNAPSHOT_RECORD];
        },
      });
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        undefined,
        undefined,
        store,
      );

      const response = await request(app).get("/v1/snapshots").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "jwt-valido");

      expect(response.body).toEqual({ snapshots: [SNAPSHOT_RECORD] });
      expect(receivedUserId).toBe("user-1");
    });
  });

  describe("GET /v1/devices/:deviceId/snapshots", () => {
    it("filtra por userId y deviceId", async () => {
      let received: { userId?: string; deviceId?: string } = {};
      const store = fakeDeviceSnapshotStore({
        listByUser: async (userId, deviceId) => {
          received = { userId, deviceId };
          return [SNAPSHOT_RECORD];
        },
      });
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        undefined,
        undefined,
        store,
      );

      await request(app).get("/v1/devices/device-1/snapshots").set("Authorization", `Bearer ${TOKEN}`).set("X-User-Token", "jwt-valido");

      expect(received).toEqual({ userId: "user-1", deviceId: "device-1" });
    });
  });

  describe("DELETE /v1/snapshots/:id", () => {
    it("borra un snapshot del dueño y devuelve 204", async () => {
      let deletedId: string | undefined;
      const store = fakeDeviceSnapshotStore({ delete: async (id) => void (deletedId = id) });
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        undefined,
        undefined,
        store,
      );

      const response = await request(app)
        .delete("/v1/snapshots/snap-1")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(204);
      expect(deletedId).toBe("snap-1");
    });

    it("rechaza con 404 si el snapshot pertenece a otro usuario", async () => {
      const store = fakeDeviceSnapshotStore({ get: async () => ({ ...SNAPSHOT_RECORD, userId: "otro-user" }) });
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        undefined,
        undefined,
        store,
      );

      const response = await request(app)
        .delete("/v1/snapshots/snap-1")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(404);
    });

    it("sin sesión de usuario, responde 501", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, undefined, fakeDeviceSnapshotStore());

      const response = await request(app).delete("/v1/snapshots/snap-1").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(501);
    });
  });

  describe("GET /v1/snapshots/:id/content", () => {
    it("devuelve el contenido parseado de un snapshot 'source'", async () => {
      const bundleContent = Buffer.from(JSON.stringify({ files: [{ path: "main.py", content: "print(1)" }] }), "utf-8");
      const store = fakeDeviceSnapshotStore({ get: async () => SNAPSHOT_RECORD, downloadContent: async () => bundleContent });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .get("/v1/snapshots/snap-1/content")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ backupType: "source", content: { files: [{ path: "main.py", content: "print(1)" }] } });
    });

    it("rechaza con 400 un snapshot 'binary'", async () => {
      const store = fakeDeviceSnapshotStore({ get: async () => ({ ...SNAPSHOT_RECORD, backupType: "binary" }) });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .get("/v1/snapshots/snap-1/content")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(400);
    });

    it("rechaza con 404 si el snapshot pertenece a otro usuario", async () => {
      const store = fakeDeviceSnapshotStore({ get: async () => ({ ...SNAPSHOT_RECORD, userId: "otro-user" }) });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .get("/v1/snapshots/snap-1/content")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(404);
    });

    it("sin sesión de usuario, responde 501", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, undefined, fakeDeviceSnapshotStore());

      const response = await request(app).get("/v1/snapshots/snap-1/content").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(501);
    });
  });

  describe("POST /v1/devices/:deviceId/snapshots/config (docs/06, Plataforma C)", () => {
    const validBody = { deviceKind: "modbus", edgeAgentId: "agent-1", deviceName: "PLC del taller" };

    it("arma el bundle desde las alertas del dispositivo y lo sube, sin pasar por el Edge Agent", async () => {
      const alertRules = [
        { id: "r1", capabilityRef: "c_a1_modbus_plc1_read_temp", comparator: "above" as const, threshold: 40, label: "la temperatura", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "r2", capabilityRef: "c_a1_otro_dispositivo_read_x", comparator: "above" as const, threshold: 1, label: "x", createdAt: "2026-01-01T00:00:00.000Z" },
      ];
      const gateway = fakeGateway({ alertMonitor: { list: () => alertRules, restore: () => {} } as unknown as Gateway["alertMonitor"] });
      let uploadedContent: Buffer | undefined;
      const store = fakeDeviceSnapshotStore({
        uploadContent: async (_path, content) => {
          uploadedContent = content;
        },
        create: async (input) => ({ ...SNAPSHOT_RECORD, backupType: input.backupType, fileCount: input.fileCount }),
      });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .post("/v1/devices/modbus_plc1/snapshots/config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido")
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.snapshot).toMatchObject({ backupType: "config", fileCount: 1 });
      const bundle = JSON.parse(uploadedContent!.toString("utf-8"));
      expect(bundle.alertRules).toEqual([alertRules[0]]);
    });

    it("rechaza con 400 si faltan 'deviceKind'/'edgeAgentId'", async () => {
      const app = appWith(
        fakeGateway(),
        undefined,
        fakeAuthPort(async () => ({ userId: "user-1", email: "" })),
        undefined,
        undefined,
        undefined,
        fakeDeviceSnapshotStore(),
      );

      const response = await request(app)
        .post("/v1/devices/modbus_plc1/snapshots/config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido")
        .send({});

      expect(response.status).toBe(400);
    });

    it("sin sesión de usuario, responde 401", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, undefined, fakeDeviceSnapshotStore());

      const response = await request(app).post("/v1/devices/modbus_plc1/snapshots/config").set("Authorization", `Bearer ${TOKEN}`).send(validBody);

      expect(response.status).toBe(401);
    });

    it("sin deviceSnapshotStore configurado, responde 501", async () => {
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })));

      const response = await request(app)
        .post("/v1/devices/modbus_plc1/snapshots/config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido")
        .send(validBody);

      expect(response.status).toBe(501);
    });

    it("rechaza con 500 si uploadContent() lanza", async () => {
      const store = fakeDeviceSnapshotStore({
        uploadContent: async () => {
          throw new Error("bucket lleno");
        },
      });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .post("/v1/devices/modbus_plc1/snapshots/config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido")
        .send(validBody);

      expect(response.status).toBe(500);
    });
  });

  describe("POST /v1/snapshots/:id/restore-config", () => {
    const configRecord: DeviceSnapshotRecord = { ...SNAPSHOT_RECORD, backupType: "config" };
    const rule = { id: "r1", capabilityRef: "c_a1_modbus_plc1_read_temp", comparator: "above" as const, threshold: 40, label: "la temperatura", createdAt: "2026-01-01T00:00:00.000Z" };
    const bundleContent = Buffer.from(JSON.stringify({ deviceId: "modbus_plc1", deviceKind: "modbus", generatedAt: "2026-01-01T00:00:00.000Z", alertRules: [rule] }), "utf-8");

    it("restaura las alertas del snapshot vía AlertMonitor.restore()", async () => {
      const restored: unknown[] = [];
      const gateway = fakeGateway({
        alertMonitor: { list: () => [], restore: (r: unknown) => void restored.push(r) } as unknown as Gateway["alertMonitor"],
      });
      const store = fakeDeviceSnapshotStore({ get: async () => configRecord, downloadContent: async () => bundleContent });
      const app = appWith(gateway, undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .post("/v1/snapshots/snap-1/restore-config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ restored: { alertRules: 1 } });
      expect(restored).toEqual([rule]);
    });

    it("rechaza con 400 si el snapshot no es de tipo 'config'", async () => {
      const store = fakeDeviceSnapshotStore({ get: async () => ({ ...SNAPSHOT_RECORD, backupType: "source" }) });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .post("/v1/snapshots/snap-1/restore-config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(400);
    });

    it("rechaza con 404 si el snapshot pertenece a otro usuario", async () => {
      const store = fakeDeviceSnapshotStore({ get: async () => ({ ...configRecord, userId: "otro-user" }) });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .post("/v1/snapshots/snap-1/restore-config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(404);
    });

    it("sin sesión de usuario, responde 401", async () => {
      const app = appWith(fakeGateway(), undefined, undefined, undefined, undefined, undefined, fakeDeviceSnapshotStore());

      const response = await request(app).post("/v1/snapshots/snap-1/restore-config").set("Authorization", `Bearer ${TOKEN}`);

      expect(response.status).toBe(401);
    });

    it("rechaza con 500 si el contenido descargado está corrupto", async () => {
      const store = fakeDeviceSnapshotStore({ get: async () => configRecord, downloadContent: async () => Buffer.from("no es json") });
      const app = appWith(fakeGateway(), undefined, fakeAuthPort(async () => ({ userId: "user-1", email: "" })), undefined, undefined, undefined, store);

      const response = await request(app)
        .post("/v1/snapshots/snap-1/restore-config")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set("X-User-Token", "jwt-valido");

      expect(response.status).toBe(500);
    });
  });
});
