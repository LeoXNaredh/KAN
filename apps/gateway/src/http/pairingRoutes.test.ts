import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { PairingPort } from "@kan/core";
import { createPairingRoutes } from "./pairingRoutes";

function fakePairingPort(
  claim: PairingPort["claim"],
  getPluginConfig: PairingPort["getPluginConfig"] = async () => undefined,
): PairingPort {
  return {
    generateCode: async () => ({ code: "", expiresAt: "" }),
    claim,
    resolveOwner: async () => undefined,
    getPluginConfig,
  };
}

function appWith(pairingPort: PairingPort) {
  const app = express();
  app.use(express.json());
  app.use(createPairingRoutes(pairingPort));
  return app;
}

describe("POST /v1/pairing/claim", () => {
  it("con un código válido, devuelve ownerId y secret — sin necesitar ningún token", async () => {
    const app = appWith(fakePairingPort(async () => ({ ownerId: "user-1", secret: "secreto-largo" })));

    const response = await request(app).post("/v1/pairing/claim").send({ pairingCode: "ABCD1234", edgeAgentId: "agent-1" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ownerId: "user-1", secret: "secreto-largo" });
  });

  it("rechaza con 400 si falta 'pairingCode' o 'edgeAgentId'", async () => {
    const app = appWith(fakePairingPort(async () => ({ ownerId: "user-1", secret: "x" })));

    const response = await request(app).post("/v1/pairing/claim").send({ edgeAgentId: "agent-1" });

    expect(response.status).toBe(400);
  });

  it("rechaza con 400 si el código es inválido, vencido o ya usado (claim() devuelve undefined)", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const response = await request(app).post("/v1/pairing/claim").send({ pairingCode: "VENCIDO", edgeAgentId: "agent-1" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Código de pairing inválido, vencido o ya usado." });
  });

  it("rechaza con 429 al superar el rate limit propio (más estricto que el general, docs/16 P6)", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const responses = [];
    for (let i = 0; i < 11; i++) {
      responses.push(await request(app).post("/v1/pairing/claim").send({ pairingCode: "X", edgeAgentId: "agent-1" }));
    }

    expect(responses.slice(0, 10).every((r) => r.status === 400)).toBe(true);
    expect(responses[10].status).toBe(429);
  });
});

describe("GET /v1/pairing/config", () => {
  it("con un secreto válido, devuelve la config de plugins", async () => {
    const app = appWith(
      fakePairingPort(
        async () => undefined,
        async () => ({ KAN_SSH_HOSTS: "casa|192.168.1.20:22|kan|password|x" }),
      ),
    );

    const response = await request(app)
      .get("/v1/pairing/config")
      .set("X-Pairing-Secret", "secreto-largo")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ pluginConfig: { KAN_SSH_HOSTS: "casa|192.168.1.20:22|kan|password|x" } });
  });

  it("rechaza con 400 si faltan los headers de secreto/edgeAgentId", async () => {
    const app = appWith(fakePairingPort(async () => undefined));

    const response = await request(app).get("/v1/pairing/config");

    expect(response.status).toBe(400);
  });

  it("rechaza con 401 si el secreto no resuelve a ningún pairing", async () => {
    const app = appWith(fakePairingPort(async () => undefined, async () => undefined));

    const response = await request(app)
      .get("/v1/pairing/config")
      .set("X-Pairing-Secret", "secreto-invalido")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(401);
  });

  it("rechaza con 500 si getPluginConfig() lanza", async () => {
    const app = appWith(
      fakePairingPort(async () => undefined, async () => Promise.reject(new Error("db caída"))),
    );

    const response = await request(app)
      .get("/v1/pairing/config")
      .set("X-Pairing-Secret", "secreto")
      .set("X-Edge-Agent-Id", "agent-1");

    expect(response.status).toBe(500);
  });
});
