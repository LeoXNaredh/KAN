import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { HttpDevicePlugin } from "./index";
import { FakeHttpTransport } from "./infra/FakeHttpTransport";

const BASE_URL = "https://api.example.com";

describe("HttpDevicePlugin", () => {
  const originalEndpoints = process.env.KAN_HTTP_ENDPOINTS;

  afterEach(() => {
    if (originalEndpoints === undefined) delete process.env.KAN_HTTP_ENDPOINTS;
    else process.env.KAN_HTTP_ENDPOINTS = originalEndpoints;
  });

  beforeEach(() => {
    delete process.env.KAN_HTTP_ENDPOINTS;
  });

  it("discover() devuelve lista vacía sin KAN_HTTP_ENDPOINTS configurado", async () => {
    const plugin = new HttpDevicePlugin(new FakeHttpTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los endpoints que responden, ignora los inalcanzables", async () => {
    process.env.KAN_HTTP_ENDPOINTS = `api1|${BASE_URL},api2|https://inalcanzable.example.com`;
    const transport = new FakeHttpTransport({ "https://inalcanzable.example.com": { reachable: false } });
    const plugin = new HttpDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("api1");
    expect(devices[0].name).toContain("api.example.com");
  });

  it("el nombre del dispositivo nunca incluye el valor del header de auth", async () => {
    process.env.KAN_HTTP_ENDPOINTS = `api1|${BASE_URL}|Authorization:Bearer super-secreto`;
    const plugin = new HttpDevicePlugin(new FakeHttpTransport());

    const [device] = await plugin.discover();
    expect(device.name).not.toContain("super-secreto");
  });

  it("expone 5 capabilities con la severidad correcta", () => {
    const plugin = new HttpDevicePlugin(new FakeHttpTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["http_get", "http_post", "http_put", "http_patch", "http_delete"]);
    expect(capabilities.map((c) => c.severity)).toEqual([
      "read-only",
      "irreversible-material",
      "irreversible-material",
      "irreversible-material",
      "irreversible-material",
    ]);
    expect(capabilities.every((c) => c.targetParam === "path")).toBe(true);
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new HttpDevicePlugin(new FakeHttpTransport());
    const result = await plugin.invoke("http_desconocido", "http_get", { path: "/status" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: http_desconocido" });
  });

  describe("con un endpoint descubierto", () => {
    let plugin: HttpDevicePlugin;
    let transport: FakeHttpTransport;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_HTTP_ENDPOINTS = `api1|${BASE_URL}|Authorization:Bearer xyz`;
      transport = new FakeHttpTransport({
        [BASE_URL]: {
          handler: (options) => {
            if (options.path === "/echo") return { status: 200, body: { received: options.body } };
            return { status: 404, body: { error: "not found" } };
          },
        },
      });
      plugin = new HttpDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("http_get manda GET con el path y el header de auth configurado", async () => {
      const result = await plugin.invoke(deviceId, "http_get", { path: "/status" });
      expect(result.success).toBe(true);
      expect(transport.requests[0].options.method).toBe("GET");
      expect(transport.requests[0].options.authHeader).toEqual({ name: "Authorization", value: "Bearer xyz" });
    });

    it("http_post manda el body y lo devuelve el fake eco", async () => {
      const result = await plugin.invoke(deviceId, "http_post", { path: "/echo", body: { hola: "mundo" } });
      expect(result.success).toBe(true);
      expect((result.data as { body: { received: unknown } }).body.received).toEqual({ hola: "mundo" });
    });

    it("http_put/http_patch/http_delete mandan el método correcto", async () => {
      await plugin.invoke(deviceId, "http_put", { path: "/x" });
      await plugin.invoke(deviceId, "http_patch", { path: "/x" });
      await plugin.invoke(deviceId, "http_delete", { path: "/x" });

      const methods = transport.requests.map((r) => r.options.method);
      expect(methods).toEqual(["PUT", "PATCH", "DELETE"]);
    });

    it("rechaza sin 'path'", async () => {
      const result = await plugin.invoke(deviceId, "http_get", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/path/);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", { path: "/x" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("un error de red en el transporte se devuelve como CapabilityResult, no como throw", async () => {
      const failingTransport = new FakeHttpTransport({
        [BASE_URL]: {
          handler: () => {
            throw new Error("ECONNREFUSED");
          },
        },
      });
      process.env.KAN_HTTP_ENDPOINTS = `api1|${BASE_URL}`;
      const failingPlugin = new HttpDevicePlugin(failingTransport);
      const [device] = await failingPlugin.discover();
      await failingPlugin.connect(device.id);

      const result = await failingPlugin.invoke(device.id, "http_get", { path: "/status" });
      expect(result).toEqual({ success: false, error: "ECONNREFUSED" });
    });
  });
});
