import { createServer, type Server } from "node:http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { FetchHttpTransport } from "./FetchHttpTransport";

/**
 * Contra un http.createServer real, no un mock — mismo criterio (ADR-012)
 * que NodeMqttTransport.test.ts contra un broker aedes real.
 */
describe("FetchHttpTransport (integración contra un servidor HTTP real)", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body: string } | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastRequest = { method: req.method, url: req.url, headers: req.headers, body };

        if (req.url === "/status" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === "/echo" && req.method === "POST") {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(body || "{}");
          return;
        }
        if (req.url === "/texto") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("no soy json");
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No se pudo levantar el servidor de prueba");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("checkReachable() da true contra un servidor real", async () => {
    const transport = new FetchHttpTransport();
    expect(await transport.checkReachable(baseUrl, 2000)).toBe(true);
  });

  it("checkReachable() da false contra un puerto sin nada escuchando", async () => {
    const transport = new FetchHttpTransport();
    expect(await transport.checkReachable("http://127.0.0.1:1", 500)).toBe(false);
  });

  it("GET real devuelve status y body parseado como JSON", async () => {
    const transport = new FetchHttpTransport();
    const response = await transport.request(baseUrl, { method: "GET", path: "/status" });
    expect(response).toEqual({ status: 200, body: { ok: true } });
  });

  it("POST real manda el body como JSON y el header de auth configurado", async () => {
    const transport = new FetchHttpTransport();
    const response = await transport.request(baseUrl, {
      method: "POST",
      path: "/echo",
      body: { hola: "mundo" },
      authHeader: { name: "Authorization", value: "Bearer xyz" },
    });

    expect(response).toEqual({ status: 201, body: { hola: "mundo" } });
    expect(lastRequest?.headers.authorization).toBe("Bearer xyz");
    expect(lastRequest?.headers["content-type"]).toBe("application/json");
  });

  it("un body de respuesta que no es JSON válido se devuelve como texto crudo, no explota", async () => {
    const transport = new FetchHttpTransport();
    const response = await transport.request(baseUrl, { method: "GET", path: "/texto" });
    expect(response).toEqual({ status: 200, body: "no soy json" });
  });

  it("query params reales se agregan a la URL", async () => {
    const transport = new FetchHttpTransport();
    await transport.request(baseUrl, { method: "GET", path: "/status", query: { a: "1", b: "dos" } });
    expect(lastRequest?.url).toBe("/status?a=1&b=dos");
  });
});
