import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { OpcuaDevicePlugin } from "./index";
import { FakeOpcuaTransport } from "./infra/FakeOpcuaTransport";

const ENDPOINT_URL = "opc.tcp://192.168.1.50:4840";

describe("OpcuaDevicePlugin", () => {
  const originalTargets = process.env.KAN_OPCUA_TARGETS;

  afterEach(() => {
    if (originalTargets === undefined) delete process.env.KAN_OPCUA_TARGETS;
    else process.env.KAN_OPCUA_TARGETS = originalTargets;
  });

  beforeEach(() => {
    delete process.env.KAN_OPCUA_TARGETS;
  });

  it("discover() devuelve lista vacía sin KAN_OPCUA_TARGETS configurado", async () => {
    const plugin = new OpcuaDevicePlugin(new FakeOpcuaTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los endpoints alcanzables", async () => {
    process.env.KAN_OPCUA_TARGETS = `plc1|${ENDPOINT_URL},roto|opc.tcp://192.168.1.99:4840`;
    const transport = new FakeOpcuaTransport({ "opc.tcp://192.168.1.99:4840": { reachable: false } });
    const plugin = new OpcuaDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("plc1");
  });

  it("el nombre del dispositivo nunca incluye credenciales", async () => {
    process.env.KAN_OPCUA_TARGETS = `plc1|${ENDPOINT_URL}|admin|secreto`;
    const plugin = new OpcuaDevicePlugin(new FakeOpcuaTransport());

    const [device] = await plugin.discover();
    expect(device.name).not.toContain("secreto");
    expect(device.name).not.toContain("admin");
  });

  it("expone 4 capabilities con la severidad correcta; discover_io_map no tiene targetParam (opera sobre todo el address space)", () => {
    const plugin = new OpcuaDevicePlugin(new FakeOpcuaTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["read_node", "write_node", "browse_node", "discover_io_map"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["read-only", "irreversible-material", "read-only", "read-only"]);
    expect(capabilities.filter((c) => c.name !== "discover_io_map").every((c) => c.targetParam === "nodeId")).toBe(true);
    expect(capabilities.find((c) => c.name === "discover_io_map")?.targetParam).toBeUndefined();
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new OpcuaDevicePlugin(new FakeOpcuaTransport());
    const result = await plugin.invoke("opcua_desconocido", "read_node", { nodeId: "ns=1;s=X" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: opcua_desconocido" });
  });

  describe("con un endpoint descubierto y conectado", () => {
    let plugin: OpcuaDevicePlugin;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_OPCUA_TARGETS = `plc1|${ENDPOINT_URL}`;
      const transport = new FakeOpcuaTransport({
        [ENDPOINT_URL]: {
          nodes: { "ns=1;s=Temperatura": { value: 21.5, dataType: "Double" } },
          browseChildren: {
            RootFolder: [
              { nodeId: "ns=0;i=85", browseName: "Objects", nodeClass: "Object" },
              { nodeId: "ns=1;s=Temperatura", browseName: "Temperatura", nodeClass: "Variable" },
            ],
          },
        },
      });
      plugin = new OpcuaDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("read_node devuelve el valor real de un nodo", async () => {
      const result = await plugin.invoke(deviceId, "read_node", { nodeId: "ns=1;s=Temperatura" });
      expect(result).toEqual({ success: true, data: { value: 21.5, dataType: "Double", statusCode: "Good" } });
    });

    it("read_node sobre un nodo inexistente da error claro, no throw", async () => {
      const result = await plugin.invoke(deviceId, "read_node", { nodeId: "ns=1;s=NoExiste" });
      expect(result.success).toBe(false);
    });

    it("write_node escribe y una lectura posterior confirma el nuevo valor", async () => {
      const writeResult = await plugin.invoke(deviceId, "write_node", { nodeId: "ns=1;s=Temperatura", value: 30, dataType: "Double" });
      expect(writeResult).toEqual({ success: true, data: {} });

      const readResult = await plugin.invoke(deviceId, "read_node", { nodeId: "ns=1;s=Temperatura" });
      expect((readResult.data as { value: number }).value).toBe(30);
    });

    it("write_node rechaza sin 'dataType' válido", async () => {
      const result = await plugin.invoke(deviceId, "write_node", { nodeId: "ns=1;s=X", value: 1, dataType: "NoExiste" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/dataType/);
    });

    it("write_node rechaza sin 'value'", async () => {
      const result = await plugin.invoke(deviceId, "write_node", { nodeId: "ns=1;s=X", dataType: "Double" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/value/);
    });

    it("browse_node lista los hijos reales de un nodo", async () => {
      const result = await plugin.invoke(deviceId, "browse_node", { nodeId: "RootFolder" });
      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ browseName: string }> }).entries;
      expect(entries.map((e) => e.browseName)).toEqual(["Objects", "Temperatura"]);
    });

    it("browse_node sin nodeId usa RootFolder por defecto", async () => {
      const result = await plugin.invoke(deviceId, "browse_node", {});
      expect(result.success).toBe(true);
      expect((result.data as { entries: unknown[] }).entries).toHaveLength(2);
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", { nodeId: "ns=1;s=X" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("read_node/write_node fallan con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);

      const results = await Promise.all([
        plugin.invoke(deviceId, "read_node", { nodeId: "ns=1;s=Temperatura" }),
        plugin.invoke(deviceId, "write_node", { nodeId: "ns=1;s=Temperatura", value: 1, dataType: "Double" }),
      ]);
      results.forEach((result) => expect(result).toEqual({ success: false, error: "Dispositivo no conectado" }));
    });
  });

  describe("discover_io_map", () => {
    async function connectedPlugin(): Promise<{ plugin: OpcuaDevicePlugin; deviceId: string }> {
      process.env.KAN_OPCUA_TARGETS = `plc1|${ENDPOINT_URL}`;
      const transport = new FakeOpcuaTransport({
        [ENDPOINT_URL]: {
          nodes: {
            "ns=1;s=Temperatura": { value: 21.5, dataType: "Double" },
            "ns=1;s=Presion": { value: 1013, dataType: "Double" },
          },
          browseChildren: {
            ObjectsFolder: [
              { nodeId: "ns=1;s=Sensores", browseName: "Sensores", nodeClass: "Object" },
              { nodeId: "ns=1;s=Presion", browseName: "Presion", nodeClass: "Variable" },
            ],
            "ns=1;s=Sensores": [{ nodeId: "ns=1;s=Temperatura", browseName: "Temperatura", nodeClass: "Variable" }],
          },
        },
      });
      const plugin = new OpcuaDevicePlugin(transport);
      const [device] = await plugin.discover();
      await plugin.connect(device.id);
      return { plugin, deviceId: device.id };
    }

    it("recorre recursivamente desde ObjectsFolder por defecto y devuelve solo las Variables encontradas", async () => {
      const { plugin, deviceId } = await connectedPlugin();

      const result = await plugin.invoke(deviceId, "discover_io_map", {});
      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ target: string; type: string; mode: string; value: unknown; label?: string }> }).entries;
      expect(entries).toEqual(
        expect.arrayContaining([
          { target: "ns=1;s=Presion", type: "node", mode: "unknown", value: 1013, label: "Presion" },
          { target: "ns=1;s=Temperatura", type: "node", mode: "unknown", value: 21.5, label: "Temperatura" },
        ]),
      );
      expect(entries).toHaveLength(2);
    });

    it("respeta maxDepth: no baja a hijos de un nivel más profundo que el permitido", async () => {
      const { plugin, deviceId } = await connectedPlugin();

      const result = await plugin.invoke(deviceId, "discover_io_map", { maxDepth: 0 });
      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ target: string }> }).entries;
      // Con maxDepth 0 solo se listan las Variables del propio ObjectsFolder — "Sensores" es un Object, se descarta sin bajar a sus hijos.
      expect(entries).toEqual([{ target: "ns=1;s=Presion", type: "node", mode: "unknown", value: 1013, label: "Presion" }]);
    });

    it("respeta maxNodes: corta antes de agotar el árbol si se supera el presupuesto", async () => {
      const { plugin, deviceId } = await connectedPlugin();

      const result = await plugin.invoke(deviceId, "discover_io_map", { maxNodes: 1 });
      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ target: string }> }).entries;
      expect(entries.length).toBeLessThanOrEqual(1);
    });

    it("acepta un rootNodeId explícito distinto del default", async () => {
      const { plugin, deviceId } = await connectedPlugin();

      const result = await plugin.invoke(deviceId, "discover_io_map", { rootNodeId: "ns=1;s=Sensores" });
      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ target: string }> }).entries;
      expect(entries).toEqual([{ target: "ns=1;s=Temperatura", type: "node", mode: "unknown", value: 21.5, label: "Temperatura" }]);
    });
  });
});
