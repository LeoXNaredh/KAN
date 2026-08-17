import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { rateLimitKey } from "./rateLimitKey";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

function fakeRequest(overrides: { xUserToken?: string; ip?: string }): Request {
  return {
    headers: overrides.xUserToken ? { "x-user-token": overrides.xUserToken } : {},
    ip: overrides.ip,
  } as unknown as Request;
}

describe("rateLimitKey (fix de auditoría de backend #4)", () => {
  it("con X-User-Token decodificable, usa el userId (sub) del JWT como key", () => {
    const token = fakeJwt({ sub: "user-1", exp: 9999999999 });
    const key = rateLimitKey(fakeRequest({ xUserToken: token, ip: "1.2.3.4" }));
    expect(key).toBe("user:user-1");
  });

  it("mismo userId, tokens distintos (rotación) → misma key — no depende del string crudo del token", () => {
    const tokenA = fakeJwt({ sub: "user-1" });
    const tokenB = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url")}.otra-firma`;
    expect(rateLimitKey(fakeRequest({ xUserToken: tokenA }))).toBe(rateLimitKey(fakeRequest({ xUserToken: tokenB })));
  });

  it("usuarios distintos obtienen keys distintas", () => {
    const keyA = rateLimitKey(fakeRequest({ xUserToken: fakeJwt({ sub: "user-1" }) }));
    const keyB = rateLimitKey(fakeRequest({ xUserToken: fakeJwt({ sub: "user-2" }) }));
    expect(keyA).not.toBe(keyB);
  });

  it("con X-User-Token pero no decodificable (no es un JWT), cae al token crudo — sigue siendo estable por sesión", () => {
    const key = rateLimitKey(fakeRequest({ xUserToken: "no-es-un-jwt", ip: "1.2.3.4" }));
    expect(key).toBe("token:no-es-un-jwt");
  });

  it("con JWT sin 'sub' en el payload, cae al token crudo", () => {
    const token = fakeJwt({ role: "authenticated" });
    const key = rateLimitKey(fakeRequest({ xUserToken: token }));
    expect(key).toBe(`token:${token}`);
  });

  it("sin X-User-Token, cae a la IP (retrocompatible)", () => {
    const key = rateLimitKey(fakeRequest({ ip: "203.0.113.7" }));
    expect(key).toBe("ip:203.0.113.7");
  });

  it("sin X-User-Token y sin IP resuelta, no revienta", () => {
    const key = rateLimitKey(fakeRequest({}));
    expect(key).toBe("ip:unknown");
  });
});
