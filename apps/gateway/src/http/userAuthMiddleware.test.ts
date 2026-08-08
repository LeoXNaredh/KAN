import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { AuthPort } from "@kan/core";
import { createUserAuthMiddleware } from "./userAuthMiddleware";

function appWith(authPort?: AuthPort) {
  const app = express();
  app.use(createUserAuthMiddleware(authPort));
  app.get("/whoami", (req, res) => {
    res.json({ userId: req.userId ?? null, email: req.userEmail ?? null });
  });
  return app;
}

function fakeAuthPort(getCurrentUser: AuthPort["getCurrentUser"]): AuthPort {
  return { getCurrentUser } as AuthPort;
}

describe("createUserAuthMiddleware", () => {
  it("sin authPort configurado, no hace nada", async () => {
    const app = appWith(undefined);
    const response = await request(app).get("/whoami").set("X-User-Token", "cualquier-cosa");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: null, email: null });
  });

  it("sin header X-User-Token, no hace nada aunque haya authPort", async () => {
    const getCurrentUser = vi.fn();
    const app = appWith(fakeAuthPort(getCurrentUser));
    const response = await request(app).get("/whoami");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: null, email: null });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("con header y token válido, adjunta userId/email", async () => {
    const app = appWith(
      fakeAuthPort(async (token) => {
        expect(token).toBe("jwt-valido");
        return { userId: "user-1", email: "gio@example.com" };
      }),
    );
    const response = await request(app).get("/whoami").set("X-User-Token", "jwt-valido");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: "user-1", email: "gio@example.com" });
  });

  it("con header y token inválido (authPort devuelve undefined), responde 401", async () => {
    const app = appWith(fakeAuthPort(async () => undefined));
    const response = await request(app).get("/whoami").set("X-User-Token", "jwt-invalido");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Token de usuario inválido" });
  });

  it("si authPort.getCurrentUser lanza (ej. Supabase Auth caído), responde 401", async () => {
    const app = appWith(
      fakeAuthPort(async () => {
        throw new Error("network error");
      }),
    );
    const response = await request(app).get("/whoami").set("X-User-Token", "jwt-cualquiera");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Token de usuario inválido" });
  });
});
