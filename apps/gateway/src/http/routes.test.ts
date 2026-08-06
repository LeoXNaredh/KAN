import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { Gateway } from "@kan/gateway-core";
import { createRoutes } from "./routes";

const TOKEN = "test-internal-token";

function fakeGateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    listTools: () => [{ name: "read_sensor", description: "...", inputSchema: {} }],
    executeTool: async () => ({ success: true, data: { ok: true } }),
    agentRegistry: { list: () => [] } as unknown as Gateway["agentRegistry"],
    auditService: { list: () => [] } as unknown as Gateway["auditService"],
    ...overrides,
  } as Gateway;
}

function appWith(gateway: Gateway) {
  const app = express();
  app.use(express.json());
  app.use(createRoutes(gateway, TOKEN));
  return app;
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
});
