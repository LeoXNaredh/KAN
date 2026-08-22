import { describe, expect, it } from "vitest";
import type { AlertRule } from "../domain/entities/AlertRule";
import { alertRuleReferencesDevice, buildDeviceConfigBundle, parseDeviceConfigBundle } from "./deviceConfigSnapshot";

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "rule-1",
    capabilityRef: "c_a1b2c3d4_modbus_plc1_read_temp",
    comparator: "above",
    threshold: 40,
    label: "la temperatura",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("alertRuleReferencesDevice", () => {
  it("matchea cuando capabilityRef contiene el deviceId como segmento propio", () => {
    expect(alertRuleReferencesDevice(makeRule({ capabilityRef: "c_a1b2c3d4_modbus_plc1_read_temp" }), "modbus_plc1")).toBe(true);
  });

  it("no matchea un deviceId que es solo substring parcial de otro (modbus_plc1 vs modbus_plc10)", () => {
    expect(alertRuleReferencesDevice(makeRule({ capabilityRef: "c_a1b2c3d4_modbus_plc10_read_temp" }), "modbus_plc1")).toBe(false);
  });

  it("no matchea una capability de un dispositivo distinto", () => {
    expect(alertRuleReferencesDevice(makeRule({ capabilityRef: "c_a1b2c3d4_otro_dispositivo_read_temp" }), "modbus_plc1")).toBe(false);
  });

  it("matchea si el deviceId aparece en algún step (alerta multi-dispositivo)", () => {
    const rule = makeRule({
      capabilityRef: "c_a1b2c3d4_sensor_temp_read_temp",
      steps: [{ capabilityRef: "c_a1b2c3d4_modbus_plc1_write_relay", input: {} }],
    });
    expect(alertRuleReferencesDevice(rule, "modbus_plc1")).toBe(true);
  });
});

describe("buildDeviceConfigBundle", () => {
  it("filtra solo las reglas que referencian el dispositivo pedido", () => {
    const ruleForDevice = makeRule({ id: "r1", capabilityRef: "c_a1_modbus_plc1_read_temp" });
    const ruleForOtherDevice = makeRule({ id: "r2", capabilityRef: "c_a1_modbus_plc2_read_temp" });

    const bundle = buildDeviceConfigBundle("modbus_plc1", "modbus", [ruleForDevice, ruleForOtherDevice]);

    expect(bundle.deviceId).toBe("modbus_plc1");
    expect(bundle.deviceKind).toBe("modbus");
    expect(bundle.alertRules).toEqual([ruleForDevice]);
    expect(new Date(bundle.generatedAt).getTime()).not.toBeNaN();
  });

  it("devuelve un bundle sin reglas si ninguna referencia el dispositivo", () => {
    const bundle = buildDeviceConfigBundle("modbus_plc1", "modbus", [makeRule({ capabilityRef: "c_a1_otro_read_x" })]);
    expect(bundle.alertRules).toEqual([]);
  });
});

describe("parseDeviceConfigBundle", () => {
  it("hace round-trip con buildDeviceConfigBundle", () => {
    const rule = makeRule();
    const built = buildDeviceConfigBundle("modbus_plc1", "modbus", [rule]);
    const content = Buffer.from(JSON.stringify(built), "utf-8");

    expect(parseDeviceConfigBundle(content)).toEqual(built);
  });

  it("lanza si el contenido no es JSON válido", () => {
    expect(() => parseDeviceConfigBundle(Buffer.from("esto no es json", "utf-8"))).toThrow(/no es JSON válido/);
  });

  it("lanza si falta 'alertRules'", () => {
    expect(() => parseDeviceConfigBundle(Buffer.from(JSON.stringify({ deviceId: "x" }), "utf-8"))).toThrow(/formato inesperado/);
  });
});
