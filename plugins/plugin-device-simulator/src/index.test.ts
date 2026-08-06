import { describe, expect, it, beforeEach } from "vitest";
import { DeviceSimulatorPlugin } from "./index";

describe("DeviceSimulatorPlugin", () => {
  let plugin: DeviceSimulatorPlugin;

  beforeEach(() => {
    plugin = new DeviceSimulatorPlugin();
  });

  it("descubre exactamente un dispositivo", async () => {
    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe("simulator-1");
  });

  it("expone 3 capabilities con severidades distintas", () => {
    const capabilities = plugin.getCapabilities("simulator-1");
    expect(capabilities.map((c) => c.severity)).toEqual(["read-only", "reversible", "irreversible-material"]);
  });

  it("read_sensor devuelve una temperatura numérica", async () => {
    const result = await plugin.invoke("simulator-1", "read_sensor", {});
    expect(result.success).toBe(true);
    expect(typeof (result.data as { temperatureC: number }).temperatureC).toBe("number");
  });

  it("toggle_led enciende y apaga correctamente con input válido", async () => {
    const on = await plugin.invoke("simulator-1", "toggle_led", { on: true });
    expect(on).toEqual({ success: true, data: { ledOn: true } });

    const off = await plugin.invoke("simulator-1", "toggle_led", { on: false });
    expect(off).toEqual({ success: true, data: { ledOn: false } });
  });

  it("toggle_led rechaza 'on' como string en vez de boolean (hallazgo A1 de docs/13)", async () => {
    // Antes del fix, Boolean("false") === true invertía el comportamiento sin error.
    const result = await plugin.invoke("simulator-1", "toggle_led", { on: "false" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/boolean/);
  });

  it("toggle_led rechaza input sin 'on'", async () => {
    const result = await plugin.invoke("simulator-1", "toggle_led", {});
    expect(result.success).toBe(false);
  });

  it("move_axis acumula la distancia con input válido", async () => {
    const first = await plugin.invoke("simulator-1", "move_axis", { distanceMm: 10 });
    expect(first).toEqual({ success: true, data: { axisPositionMm: 10 } });

    const second = await plugin.invoke("simulator-1", "move_axis", { distanceMm: 5 });
    expect(second).toEqual({ success: true, data: { axisPositionMm: 15 } });
  });

  it("move_axis rechaza distanceMm no numérico sin corromper el estado (hallazgo A2 de docs/13)", async () => {
    const bad = await plugin.invoke("simulator-1", "move_axis", { distanceMm: "abc" });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/número finito/);

    // El estado no debe haber quedado en NaN — una invocación válida posterior debe funcionar normal.
    const good = await plugin.invoke("simulator-1", "move_axis", { distanceMm: 3 });
    expect(good).toEqual({ success: true, data: { axisPositionMm: 3 } });
  });

  it("move_axis rechaza Infinity", async () => {
    const result = await plugin.invoke("simulator-1", "move_axis", { distanceMm: Infinity });
    expect(result.success).toBe(false);
  });

  it("invoke rechaza un deviceId desconocido", async () => {
    const result = await plugin.invoke("otro-dispositivo", "read_sensor", {});
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: otro-dispositivo" });
  });

  it("invoke rechaza una capability desconocida", async () => {
    const result = await plugin.invoke("simulator-1", "capability_inexistente", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/desconocida/);
  });
});
