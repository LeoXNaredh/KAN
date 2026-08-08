import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { Gateway } from "@kan/gateway-core";
import type { AuthPort } from "@kan/core";
import { createRoutes, type RateLimitOptions } from "./routes";

const TOKEN = "test-internal-token";

function fakeGateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    listTools: () => [{ name: "read_sensor", description: "...", inputSchema: {} }],
    executeTool: async () => ({ success: true, data: { ok: true } }),
    agentRegistry: { list: () => [] } as unknown as Gateway["agentRegistry"],
    auditService: { list: () => [] } as unknown as Gateway["auditService"],
    scheduler: {
      list: () => [],
      schedule: () => "job-1",
      cancel: () => {},
    } as unknown as Gateway["scheduler"],
    ...overrides,
  } as Gateway;
}

function appWith(gateway: Gateway, rateLimitOptions?: RateLimitOptions, authPort?: AuthPort) {
  const app = express();
  app.use(express.json());
  app.use(createRoutes(gateway, TOKEN, rateLimitOptions, authPort));
  return app;
}

function fakeAuthPort(getCurrentUser: AuthPort["getCurrentUser"]): AuthPort {
  return { getCurrentUser } as AuthPort;
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

  it("POST /v1/jobs rechaza sin steps", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ cron: "0 8 * * *" });
    expect(response.status).toBe(400);
  });

  it("POST /v1/jobs rechaza un step sin capabilityRef", async () => {
    const app = appWith(fakeGateway());
    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
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
    const app = appWith(gateway);

    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
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
    const app = appWith(gateway);

    const response = await request(app)
      .post("/v1/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
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
});
