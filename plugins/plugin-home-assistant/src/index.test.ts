import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { FakeHttpTransport } from "@kan/plugin-http-generic";
import { HomeAssistantDevicePlugin } from "./index";

const BASE_URL = "http://homeassistant.local:8123";
const TOKEN = "token-secreto";

function haTransport(overrides: { statesBody?: unknown; apiStatus?: number } = {}) {
  return new FakeHttpTransport({
    [BASE_URL]: {
      handler: (options) => {
        if (options.path === "/api/") {
          return { status: overrides.apiStatus ?? 200, body: { message: "API running." } };
        }
        if (options.path === "/api/states") {
          return {
            status: 200,
            body: overrides.statesBody ?? [
              { entity_id: "light.living_room", state: "on", attributes: { friendly_name: "Living Room Light" } },
              { entity_id: "lock.front_door", state: "locked", attributes: {} },
              { entity_id: "sensor.temperature", state: "21.5", attributes: {} },
            ],
          };
        }
        if (options.path === "/api/states/light.living_room") {
          return { status: 200, body: { entity_id: "light.living_room", state: "on" } };
        }
        if (options.path === "/api/states/entidad.inexistente") {
          return { status: 404, body: { message: "Entity not found" } };
        }
        if (options.path === "/api/services/light/turn_on") {
          return { status: 200, body: [{ entity_id: "light.living_room", state: "on" }] };
        }
        return { status: 404, body: {} };
      },
    },
  });
}

describe("HomeAssistantDevicePlugin", () => {
  const originalInstances = process.env.KAN_HOME_ASSISTANT_INSTANCES;

  afterEach(() => {
    if (originalInstances === undefined) delete process.env.KAN_HOME_ASSISTANT_INSTANCES;
    else process.env.KAN_HOME_ASSISTANT_INSTANCES = originalInstances;
  });

  beforeEach(() => {
    delete process.env.KAN_HOME_ASSISTANT_INSTANCES;
  });

  it("discover() devuelve lista vacía sin KAN_HOME_ASSISTANT_INSTANCES configurado", async () => {
    const plugin = new HomeAssistantDevicePlugin(haTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() descarta instancias con token inválido (401), no solo las inalcanzables", async () => {
    process.env.KAN_HOME_ASSISTANT_INSTANCES = `casa|${BASE_URL}|${TOKEN}`;
    const plugin = new HomeAssistantDevicePlugin(haTransport({ apiStatus: 401 }));
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta la instancia cuando el token es válido", async () => {
    process.env.KAN_HOME_ASSISTANT_INSTANCES = `casa|${BASE_URL}|${TOKEN}`;
    const plugin = new HomeAssistantDevicePlugin(haTransport());

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("casa");
    expect(devices[0].name).toContain("homeassistant.local:8123");
  });

  it("el nombre del dispositivo nunca incluye el token", async () => {
    process.env.KAN_HOME_ASSISTANT_INSTANCES = `casa|${BASE_URL}|${TOKEN}`;
    const plugin = new HomeAssistantDevicePlugin(haTransport());

    const [device] = await plugin.discover();
    expect(device.name).not.toContain(TOKEN);
  });

  it("expone 3 capabilities con la severidad correcta", () => {
    const plugin = new HomeAssistantDevicePlugin(haTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["list_ha_entities", "get_ha_state", "call_ha_service"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["read-only", "read-only", "irreversible-material"]);
    expect(capabilities.filter((c) => c.targetParam === "entity_id")).toHaveLength(2);
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new HomeAssistantDevicePlugin(haTransport());
    const result = await plugin.invoke("ha_desconocido", "get_ha_state", { entity_id: "light.living_room" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: ha_desconocido" });
  });

  describe("con una instancia descubierta y conectada", () => {
    let plugin: HomeAssistantDevicePlugin;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_HOME_ASSISTANT_INSTANCES = `casa|${BASE_URL}|${TOKEN}`;
      plugin = new HomeAssistantDevicePlugin(haTransport());
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("connect() puebla listTargets() con todas las entidades y su severidad por dominio", () => {
      const targets = plugin.listTargets(deviceId);
      expect(targets).toEqual([
        { target: "light.living_room", suggestedAlias: "Living Room Light", defaultSeverity: "irreversible-material" },
        { target: "lock.front_door", suggestedAlias: undefined, defaultSeverity: "safety-critical" },
        { target: "sensor.temperature", suggestedAlias: undefined, defaultSeverity: "read-only" },
      ]);
    });

    it("list_ha_entities devuelve las entidades", async () => {
      const result = await plugin.invoke(deviceId, "list_ha_entities", {});
      expect(result.success).toBe(true);
      const entities = (result.data as { entities: Array<{ entity_id: string }> }).entities;
      expect(entities.map((e) => e.entity_id)).toContain("light.living_room");
    });

    it("get_ha_state devuelve el estado de una entidad real", async () => {
      const result = await plugin.invoke(deviceId, "get_ha_state", { entity_id: "light.living_room" });
      expect(result).toEqual({ success: true, data: { entity_id: "light.living_room", state: "on" } });
    });

    it("get_ha_state sobre una entidad inexistente da error claro (404 -> mensaje, no throw)", async () => {
      const result = await plugin.invoke(deviceId, "get_ha_state", { entity_id: "entidad.inexistente" });
      expect(result).toEqual({ success: false, error: "Entidad desconocida: entidad.inexistente" });
    });

    it("get_ha_state/call_ha_service rechazan sin 'entity_id' válido", async () => {
      const results = await Promise.all([
        plugin.invoke(deviceId, "get_ha_state", {}),
        plugin.invoke(deviceId, "get_ha_state", { entity_id: "sin_punto" }),
        plugin.invoke(deviceId, "call_ha_service", { domain: "light", service: "turn_on" }),
      ]);
      results.forEach((result) => {
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/entity_id/);
      });
    });

    it("call_ha_service manda domain/service/entity_id y datos extra al POST correcto", async () => {
      const result = await plugin.invoke(deviceId, "call_ha_service", {
        domain: "light",
        service: "turn_on",
        entity_id: "light.living_room",
        data: { brightness: 128 },
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ entity_id: "light.living_room", state: "on" }]);
    });

    it("call_ha_service rechaza sin 'domain' o 'service'", async () => {
      const result = await plugin.invoke(deviceId, "call_ha_service", { entity_id: "light.living_room" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/domain/);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("un error de red en una capability (no en discover) se devuelve como CapabilityResult, no como throw", async () => {
      const flakyTransport = new FakeHttpTransport({
        [BASE_URL]: {
          handler: (options) => {
            if (options.path === "/api/") return { status: 200, body: {} };
            if (options.path === "/api/states") return { status: 200, body: [] };
            throw new Error("ECONNREFUSED");
          },
        },
      });
      process.env.KAN_HOME_ASSISTANT_INSTANCES = `casa|${BASE_URL}|${TOKEN}`;
      const flakyPlugin = new HomeAssistantDevicePlugin(flakyTransport);
      const [device] = await flakyPlugin.discover();
      await flakyPlugin.connect(device.id);

      const result = await flakyPlugin.invoke(device.id, "get_ha_state", { entity_id: "light.living_room" });
      expect(result).toEqual({ success: false, error: "ECONNREFUSED" });
    });
  });
});
