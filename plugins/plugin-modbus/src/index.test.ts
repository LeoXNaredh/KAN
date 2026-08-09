import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ModbusDevicePlugin, type ModbusTransportPort } from "./index";
import { FakeModbusTransport } from "./infra/FakeModbusTransport";

describe("ModbusDevicePlugin", () => {
  const originalTargets = process.env.KAN_MODBUS_TARGETS;

  afterEach(() => {
    if (originalTargets === undefined) delete process.env.KAN_MODBUS_TARGETS;
    else process.env.KAN_MODBUS_TARGETS = originalTargets;
  });

  beforeEach(() => {
    delete process.env.KAN_MODBUS_TARGETS;
  });

  it("discover() devuelve lista vacía sin KAN_MODBUS_TARGETS configurado", async () => {
    const plugin = new ModbusDevicePlugin(new FakeModbusTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los targets alcanzables, en sus dos formas (tcp y rtu-serial)", async () => {
    process.env.KAN_MODBUS_TARGETS = "plc1|tcp|192.168.1.50:502,sensor1|rtu-serial|COM3:9600,roto|tcp|10.0.0.1:502";
    const transport = new FakeModbusTransport({ "tcp:10.0.0.1:502": { reachable: false } });
    const plugin = new ModbusDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d.name)).toEqual(["Modbus (plc1, TCP 192.168.1.50:502)", "Modbus (sensor1, RTU COM3@9600)"]);
  });

  it("discover() ignora entradas mal formadas (tipo desconocido, sin puerto)", async () => {
    process.env.KAN_MODBUS_TARGETS = "malo|udp|host:1,otro_malo|tcp|host_sin_puerto,ok|tcp|192.168.1.1:502";
    const plugin = new ModbusDevicePlugin(new FakeModbusTransport());

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("ok");
  });

  it("rtu-serial sin baudRate explícito usa el default 9600", async () => {
    process.env.KAN_MODBUS_TARGETS = "sensor1|rtu-serial|COM3";
    const plugin = new ModbusDevicePlugin(new FakeModbusTransport());

    const [device] = await plugin.discover();
    expect(device.name).toContain("COM3@9600");
  });

  it("expone 4 capabilities con la severidad correcta, todas con targetParam 'register'", () => {
    const plugin = new ModbusDevicePlugin(new FakeModbusTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["read_registers", "read_coils", "write_register", "write_coil"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["read-only", "read-only", "irreversible-material", "irreversible-material"]);
    expect(capabilities.every((c) => c.targetParam === "register")).toBe(true);
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new ModbusDevicePlugin(new FakeModbusTransport());
    const result = await plugin.invoke("modbus_desconocido", "read_registers", { register: "holding:100" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: modbus_desconocido" });
  });

  describe("con un target descubierto y conectado", () => {
    let plugin: ModbusDevicePlugin;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_MODBUS_TARGETS = "plc1|tcp|192.168.1.50:502";
      const transport = new FakeModbusTransport({
        "tcp:192.168.1.50:502": {
          unitRegisters: {
            1: {
              holding: { 100: 42, 101: 43 },
              input: { 100: 215 },
              coils: { 5: true },
              discrete: { 7: false },
            },
          },
        },
      });
      plugin = new ModbusDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("read_registers lee holding registers reales", async () => {
      const result = await plugin.invoke(deviceId, "read_registers", { register: "holding:100", length: 2 });
      expect(result).toEqual({ success: true, data: { values: [42, 43] } });
    });

    it("read_registers lee input registers reales", async () => {
      const result = await plugin.invoke(deviceId, "read_registers", { register: "input:100" });
      expect(result).toEqual({ success: true, data: { values: [215] } });
    });

    it("read_coils lee coils y discrete inputs reales", async () => {
      const coilResult = await plugin.invoke(deviceId, "read_coils", { register: "coil:5" });
      expect(coilResult).toEqual({ success: true, data: { values: [true] } });

      const discreteResult = await plugin.invoke(deviceId, "read_coils", { register: "discrete:7" });
      expect(discreteResult).toEqual({ success: true, data: { values: [false] } });
    });

    it("write_register escribe y el valor queda disponible en una lectura posterior", async () => {
      const writeResult = await plugin.invoke(deviceId, "write_register", { register: "holding:200", value: 999 });
      expect(writeResult).toEqual({ success: true, data: {} });

      const readResult = await plugin.invoke(deviceId, "read_registers", { register: "holding:200" });
      expect(readResult).toEqual({ success: true, data: { values: [999] } });
    });

    it("write_coil escribe y el valor queda disponible en una lectura posterior", async () => {
      const writeResult = await plugin.invoke(deviceId, "write_coil", { register: "coil:10", value: true });
      expect(writeResult).toEqual({ success: true, data: {} });

      const readResult = await plugin.invoke(deviceId, "read_coils", { register: "coil:10" });
      expect(readResult).toEqual({ success: true, data: { values: [true] } });
    });

    it("read_registers rechaza un 'register' de tipo coil/discrete (espacio equivocado)", async () => {
      const result = await plugin.invoke(deviceId, "read_registers", { register: "coil:5" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no es válido acá/);
    });

    it("write_register rechaza un 'register' de tipo input (input registers son de solo lectura por protocolo)", async () => {
      const result = await plugin.invoke(deviceId, "write_register", { register: "input:100", value: 1 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no es válido acá/);
    });

    it("rechaza un 'register' con formato inválido", async () => {
      const results = await Promise.all([
        plugin.invoke(deviceId, "read_registers", { register: "holding-100" }),
        plugin.invoke(deviceId, "read_registers", { register: "cosa:100" }),
        plugin.invoke(deviceId, "read_registers", {}),
      ]);
      results.forEach((result) => expect(result.success).toBe(false));
    });

    it("write_register/write_coil rechazan sin 'value' del tipo correcto", async () => {
      const badNumber = await plugin.invoke(deviceId, "write_register", { register: "holding:100", value: "no" });
      expect(badNumber.success).toBe(false);
      expect(badNumber.error).toMatch(/value/);

      const badBoolean = await plugin.invoke(deviceId, "write_coil", { register: "coil:5", value: "no" });
      expect(badBoolean.success).toBe(false);
      expect(badBoolean.error).toMatch(/value/);
    });

    it("un unitId distinto del default (1) usa un espacio de registros aislado", async () => {
      const resultUnit1 = await plugin.invoke(deviceId, "read_registers", { register: "holding:100" });
      const resultUnit2 = await plugin.invoke(deviceId, "read_registers", { register: "holding:100", unitId: 2 });

      expect(resultUnit1).toEqual({ success: true, data: { values: [42] } });
      expect(resultUnit2).toEqual({ success: true, data: { values: [0] } }); // unit 2 nunca configurado, default 0
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", { register: "holding:100" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("read_registers/write_register fallan con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);

      const results = await Promise.all([
        plugin.invoke(deviceId, "read_registers", { register: "holding:100" }),
        plugin.invoke(deviceId, "write_register", { register: "holding:100", value: 1 }),
      ]);
      results.forEach((result) => expect(result).toEqual({ success: false, error: "Dispositivo no conectado" }));
    });

    it("un error de transporte se devuelve como CapabilityResult, no como throw", async () => {
      const failingTransport: ModbusTransportPort = {
        connect: async () => ({
          readHoldingRegisters: async () => {
            throw new Error("Timeout Modbus");
          },
          readInputRegisters: async () => [],
          readCoils: async () => [],
          readDiscreteInputs: async () => [],
          writeRegister: async () => {},
          writeCoil: async () => {},
          close: async () => {},
        }),
      };
      process.env.KAN_MODBUS_TARGETS = "plc1|tcp|192.168.1.50:502";
      const failingPlugin = new ModbusDevicePlugin(failingTransport);
      const [device] = await failingPlugin.discover();
      await failingPlugin.connect(device.id);

      const result = await failingPlugin.invoke(device.id, "read_registers", { register: "holding:100" });
      expect(result).toEqual({ success: false, error: "Timeout Modbus" });
    });
  });

  it("los registros de un target no se mezclan con los de otro (aislamiento multi-target)", async () => {
    process.env.KAN_MODBUS_TARGETS = "a|tcp|192.168.1.1:502,b|tcp|192.168.1.2:502";
    const transport = new FakeModbusTransport({
      "tcp:192.168.1.1:502": { unitRegisters: { 1: { holding: { 100: 111 } } } },
      "tcp:192.168.1.2:502": { unitRegisters: { 1: { holding: { 100: 222 } } } },
    });
    const plugin = new ModbusDevicePlugin(transport);

    const devices = await plugin.discover();
    const [deviceA, deviceB] = devices;
    await plugin.connect(deviceA.id);
    await plugin.connect(deviceB.id);

    const readA = await plugin.invoke(deviceA.id, "read_registers", { register: "holding:100" });
    const readB = await plugin.invoke(deviceB.id, "read_registers", { register: "holding:100" });
    expect(readA).toEqual({ success: true, data: { values: [111] } });
    expect(readB).toEqual({ success: true, data: { values: [222] } });
  });
});
