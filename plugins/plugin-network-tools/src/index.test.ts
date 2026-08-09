import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NetworkToolsDevicePlugin } from "./index";
import { FakeWolTransport } from "./infra/FakeWolTransport";
import { FakeSnmpTransport } from "./infra/FakeSnmpTransport";

const MAC = "AA:BB:CC:DD:EE:FF";

describe("NetworkToolsDevicePlugin", () => {
  const originalWol = process.env.KAN_WOL_TARGETS;
  const originalSnmp = process.env.KAN_SNMP_TARGETS;

  afterEach(() => {
    if (originalWol === undefined) delete process.env.KAN_WOL_TARGETS;
    else process.env.KAN_WOL_TARGETS = originalWol;
    if (originalSnmp === undefined) delete process.env.KAN_SNMP_TARGETS;
    else process.env.KAN_SNMP_TARGETS = originalSnmp;
  });

  beforeEach(() => {
    delete process.env.KAN_WOL_TARGETS;
    delete process.env.KAN_SNMP_TARGETS;
  });

  it("discover() devuelve lista vacía sin ninguna variable configurada", async () => {
    const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), new FakeSnmpTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  describe("Wake-on-LAN", () => {
    it("discover() siempre reporta los targets WoL configurados (fire-and-forget, no hay forma de confirmar alcanzabilidad)", async () => {
      process.env.KAN_WOL_TARGETS = `server1|${MAC}`;
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), new FakeSnmpTransport());

      const devices = await plugin.discover();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toContain("server1");
      expect(devices[0].name).toContain(MAC);
    });

    it("discover() ignora entradas con MAC inválida", async () => {
      process.env.KAN_WOL_TARGETS = "malo|no-es-una-mac,ok|" + MAC;
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), new FakeSnmpTransport());

      const devices = await plugin.discover();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toContain("ok");
    });

    it("usa broadcast/puerto por defecto (255.255.255.255:9) sin configurar", async () => {
      process.env.KAN_WOL_TARGETS = `server1|${MAC}`;
      const wolTransport = new FakeWolTransport();
      const plugin = new NetworkToolsDevicePlugin(wolTransport, new FakeSnmpTransport());
      const [device] = await plugin.discover();

      await plugin.invoke(device.id, "wake_on_lan", {});
      expect(wolTransport.sentPackets).toEqual([{ macAddress: MAC, broadcastAddress: "255.255.255.255", port: 9 }]);
    });

    it("respeta un broadcast/puerto configurado explícitamente", async () => {
      process.env.KAN_WOL_TARGETS = `server1|${MAC}|192.168.1.255:7`;
      const wolTransport = new FakeWolTransport();
      const plugin = new NetworkToolsDevicePlugin(wolTransport, new FakeSnmpTransport());
      const [device] = await plugin.discover();

      await plugin.invoke(device.id, "wake_on_lan", {});
      expect(wolTransport.sentPackets).toEqual([{ macAddress: MAC, broadcastAddress: "192.168.1.255", port: 7 }]);
    });

    it("expone 1 capability irreversible-material, sin target (acción de todo el dispositivo)", async () => {
      process.env.KAN_WOL_TARGETS = `server1|${MAC}`;
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), new FakeSnmpTransport());
      const [device] = await plugin.discover();

      const capabilities = plugin.getCapabilities(device.id);
      expect(capabilities.map((c) => c.name)).toEqual(["wake_on_lan"]);
      expect(capabilities[0].severity).toBe("irreversible-material");
      expect(capabilities[0].targetParam).toBeUndefined();
    });

    it("wake_on_lan sobre un dispositivo desconocido da error claro", async () => {
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), new FakeSnmpTransport());
      const result = await plugin.invoke("wol_desconocido", "wake_on_lan", {});
      expect(result).toEqual({ success: false, error: "Dispositivo desconocido: wol_desconocido" });
    });
  });

  describe("SNMP", () => {
    it("discover() descarta agentes que no responden (mismo criterio que MQTT/HTTP genérico)", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161,roto|192.168.1.2:161";
      const transport = new FakeSnmpTransport({
        "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "Switch Cisco" } },
        "192.168.1.2:161": { reachable: false },
      });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);

      const devices = await plugin.discover();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toContain("switch1");
    });

    it("expone 2 capabilities read-only con targetParam 'oid'", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161";
      const transport = new FakeSnmpTransport({ "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "x" } } });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);
      const [device] = await plugin.discover();

      const capabilities = plugin.getCapabilities(device.id);
      expect(capabilities.map((c) => c.name)).toEqual(["snmp_get", "snmp_walk"]);
      expect(capabilities.every((c) => c.severity === "read-only")).toBe(true);
      expect(capabilities.every((c) => c.targetParam === "oid")).toBe(true);
    });

    it("snmp_get devuelve el valor real de un OID", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161";
      const transport = new FakeSnmpTransport({
        "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "Switch Cisco", "1.3.6.1.2.1.1.5.0": "switch-piso1" } },
      });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);
      const [device] = await plugin.discover();

      const result = await plugin.invoke(device.id, "snmp_get", { oid: "1.3.6.1.2.1.1.5.0" });
      expect(result).toEqual({ success: true, data: { oid: "1.3.6.1.2.1.1.5.0", value: "switch-piso1" } });
    });

    it("snmp_walk devuelve todos los OIDs bajo el prefijo pedido", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161";
      const transport = new FakeSnmpTransport({
        "192.168.1.1:161": {
          oids: {
            "1.3.6.1.2.1.1.1.0": "sysDescr",
            "1.3.6.1.2.1.2.2.1.1.1": "puerto1",
            "1.3.6.1.2.1.2.2.1.1.2": "puerto2",
          },
        },
      });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);
      const [device] = await plugin.discover();

      const result = await plugin.invoke(device.id, "snmp_walk", { oid: "1.3.6.1.2.1.2.2.1.1" });
      expect(result.success).toBe(true);
      const varbinds = (result.data as { varbinds: Array<{ oid: string; value: string }> }).varbinds;
      expect(varbinds).toHaveLength(2);
      expect(varbinds.map((v) => v.value)).toEqual(["puerto1", "puerto2"]);
    });

    it("rechaza sin 'oid' válido", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161";
      const transport = new FakeSnmpTransport({ "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "x" } } });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);
      const [device] = await plugin.discover();

      const results = await Promise.all([
        plugin.invoke(device.id, "snmp_get", {}),
        plugin.invoke(device.id, "snmp_get", { oid: "no-numerico" }),
      ]);
      results.forEach((result) => expect(result.success).toBe(false));
    });

    it("un OID nunca configurado da error claro, no throw", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161";
      const transport = new FakeSnmpTransport({ "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "x" } } });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);
      const [device] = await plugin.discover();

      const result = await plugin.invoke(device.id, "snmp_get", { oid: "9.9.9.9" });
      expect(result.success).toBe(false);
    });

    it("community/puerto por defecto (161/public) sin configurar explícitamente", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1";
      const transport = new FakeSnmpTransport({ "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "x" } } });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);

      const devices = await plugin.discover();
      expect(devices).toHaveLength(1);
    });

    it("invoke rechaza una capability desconocida", async () => {
      process.env.KAN_SNMP_TARGETS = "switch1|192.168.1.1:161";
      const transport = new FakeSnmpTransport({ "192.168.1.1:161": { oids: { "1.3.6.1.2.1.1.1.0": "x" } } });
      const plugin = new NetworkToolsDevicePlugin(new FakeWolTransport(), transport);
      const [device] = await plugin.discover();

      const result = await plugin.invoke(device.id, "no_existe", { oid: "1.3.6.1.2.1.1.1.0" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });
  });
});
