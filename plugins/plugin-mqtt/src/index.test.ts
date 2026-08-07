import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MqttDevicePlugin } from "./index";
import { FakeMqttTransport } from "./infra/FakeMqttTransport";

const BROKER_URL = "mqtt://127.0.0.1:1883";

describe("MqttDevicePlugin", () => {
  const originalBrokers = process.env.KAN_MQTT_BROKERS;

  afterEach(() => {
    if (originalBrokers === undefined) delete process.env.KAN_MQTT_BROKERS;
    else process.env.KAN_MQTT_BROKERS = originalBrokers;
  });

  beforeEach(() => {
    delete process.env.KAN_MQTT_BROKERS;
  });

  it("discover() devuelve lista vacía sin KAN_MQTT_BROKERS configurado", async () => {
    const plugin = new MqttDevicePlugin(new FakeMqttTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los brokers que responden, ignora los inalcanzables", async () => {
    process.env.KAN_MQTT_BROKERS = "mqtt://127.0.0.1:1883,mqtt://127.0.0.1:9999";
    const transport = new FakeMqttTransport({ "mqtt://127.0.0.1:9999": { reachable: false } });
    const plugin = new MqttDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("127.0.0.1:1883");
    expect(devices[0].name).not.toContain("9999");
  });

  it("el nombre del dispositivo nunca incluye usuario/contraseña de la URL", async () => {
    process.env.KAN_MQTT_BROKERS = "mqtt://usuario:secreto@127.0.0.1:1883";
    const plugin = new MqttDevicePlugin(new FakeMqttTransport());

    const [device] = await plugin.discover();
    expect(device.name).not.toContain("usuario");
    expect(device.name).not.toContain("secreto");
  });

  it("expone 5 capabilities con la severidad correcta", () => {
    const plugin = new MqttDevicePlugin(new FakeMqttTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual([
      "subscribe_mqtt",
      "unsubscribe_mqtt",
      "read_mqtt",
      "publish_mqtt",
      "list_mqtt_topics",
    ]);
    expect(capabilities.map((c) => c.severity)).toEqual([
      "read-only",
      "reversible",
      "read-only",
      "irreversible-material",
      "read-only",
    ]);
    expect(capabilities.filter((c) => c.targetParam === "topic")).toHaveLength(4);
  });

  it("invoke() sobre un dispositivo nunca descubierto/conectado da error claro", async () => {
    const plugin = new MqttDevicePlugin(new FakeMqttTransport());
    const result = await plugin.invoke("mqtt-desconocido", "subscribe_mqtt", { topic: "kan/test" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: mqtt-desconocido" });
  });

  describe("con un broker descubierto y conectado", () => {
    let plugin: MqttDevicePlugin;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_MQTT_BROKERS = BROKER_URL;
      const transport = new FakeMqttTransport();
      plugin = new MqttDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("subscribe_mqtt seguido de publish_mqtt alimenta read_mqtt y listTargets()", async () => {
      const subscribeResult = await plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/sensor/temp" });
      expect(subscribeResult).toEqual({ success: true, data: {} });

      const publishResult = await plugin.invoke(deviceId, "publish_mqtt", { topic: "kan/sensor/temp", payload: "23.5" });
      expect(publishResult).toEqual({ success: true, data: {} });

      const readResult = await plugin.invoke(deviceId, "read_mqtt", { topic: "kan/sensor/temp" });
      expect(readResult.success).toBe(true);
      expect((readResult.data as { payload: string }).payload).toBe("23.5");

      expect(plugin.listTargets(deviceId)).toEqual([{ target: "kan/sensor/temp", defaultSeverity: "irreversible-material" }]);
    });

    it("read_mqtt antes de recibir cualquier mensaje da un error limpio, no throw", async () => {
      await plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/sin-mensajes" });
      const result = await plugin.invoke(deviceId, "read_mqtt", { topic: "kan/sin-mensajes" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Todavía no llegó ningún mensaje/);
    });

    it("read_mqtt sobre un topic nunca suscrito da error, no throw", async () => {
      const result = await plugin.invoke(deviceId, "read_mqtt", { topic: "kan/nunca-suscrito" });
      expect(result.success).toBe(false);
    });

    it("publish_mqtt rechaza sin 'payload' string", async () => {
      const result = await plugin.invoke(deviceId, "publish_mqtt", { topic: "kan/test" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/payload/);
    });

    it("subscribe_mqtt/publish_mqtt/read_mqtt rechazan sin 'topic'", async () => {
      const results = await Promise.all([
        plugin.invoke(deviceId, "subscribe_mqtt", {}),
        plugin.invoke(deviceId, "publish_mqtt", { payload: "x" }),
        plugin.invoke(deviceId, "read_mqtt", {}),
      ]);
      results.forEach((result) => {
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/topic/);
      });
    });

    it("unsubscribe_mqtt de un topic nunca suscrito es idempotente (éxito, no error)", async () => {
      const result = await plugin.invoke(deviceId, "unsubscribe_mqtt", { topic: "kan/nunca-suscrito" });
      expect(result).toEqual({ success: true, data: {} });
    });

    it("unsubscribe_mqtt real quita el topic de listTargets()", async () => {
      await plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/sensor/temp" });
      expect(plugin.listTargets(deviceId)).toHaveLength(1);

      await plugin.invoke(deviceId, "unsubscribe_mqtt", { topic: "kan/sensor/temp" });
      expect(plugin.listTargets(deviceId)).toHaveLength(0);
    });

    it("list_mqtt_topics devuelve todos los topics cacheados con su último valor", async () => {
      await plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/a" });
      await plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/b" });
      await plugin.invoke(deviceId, "publish_mqtt", { topic: "kan/a", payload: "1" });

      const result = await plugin.invoke(deviceId, "list_mqtt_topics", {});
      expect(result.success).toBe(true);
      const topics = (result.data as { topics: Array<{ topic: string; lastPayload?: string }> }).topics;
      expect(topics.find((t) => t.topic === "kan/a")?.lastPayload).toBe("1");
      expect(topics.find((t) => t.topic === "kan/b")?.lastPayload).toBeUndefined();
    });

    it("subscribe_mqtt/unsubscribe_mqtt/publish_mqtt fallan con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);

      const results = await Promise.all([
        plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/test" }),
        plugin.invoke(deviceId, "unsubscribe_mqtt", { topic: "kan/test" }),
        plugin.invoke(deviceId, "publish_mqtt", { topic: "kan/test", payload: "x" }),
      ]);
      results.forEach((result) => {
        expect(result).toEqual({ success: false, error: "Dispositivo no conectado" });
      });
    });

    it("el caché de topics sobrevive a disconnect() — read_mqtt sigue devolviendo el último valor conocido", async () => {
      await plugin.invoke(deviceId, "subscribe_mqtt", { topic: "kan/sensor/temp" });
      await plugin.invoke(deviceId, "publish_mqtt", { topic: "kan/sensor/temp", payload: "23.5" });

      await plugin.disconnect(deviceId);

      const readResult = await plugin.invoke(deviceId, "read_mqtt", { topic: "kan/sensor/temp" });
      expect(readResult.success).toBe(true);
      expect((readResult.data as { payload: string }).payload).toBe("23.5");
      expect(plugin.listTargets(deviceId)).toEqual([{ target: "kan/sensor/temp", defaultSeverity: "irreversible-material" }]);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });
  });

  it("el caché de topics de un dispositivo no se mezcla con el de otro (aislamiento multi-broker)", async () => {
    process.env.KAN_MQTT_BROKERS = "mqtt://127.0.0.1:1883,mqtt://127.0.0.1:1884";
    const transport = new FakeMqttTransport();
    const plugin = new MqttDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(2);
    const [deviceA, deviceB] = devices;
    await plugin.connect(deviceA.id);
    await plugin.connect(deviceB.id);

    await plugin.invoke(deviceA.id, "subscribe_mqtt", { topic: "kan/shared-topic-name" });
    await plugin.invoke(deviceA.id, "publish_mqtt", { topic: "kan/shared-topic-name", payload: "de-A" });

    await plugin.invoke(deviceB.id, "subscribe_mqtt", { topic: "kan/shared-topic-name" });

    const readB = await plugin.invoke(deviceB.id, "read_mqtt", { topic: "kan/shared-topic-name" });
    expect(readB.success).toBe(false); // B nunca recibió nada — el publish de A no debe cruzar a B.
  });
});
