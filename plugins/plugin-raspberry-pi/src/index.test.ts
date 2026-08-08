import { describe, expect, it } from "vitest";
import { RaspberryPiGpioPlugin } from "./index";
import { FakeGpioPort } from "./infra/FakeGpioPort";

const DEVICE_ID = "raspberry-pi-gpio";

function plugin(options: { onPi?: boolean; accessible?: boolean; gpioPort?: FakeGpioPort } = {}) {
  const gpioPort = options.gpioPort ?? new FakeGpioPort(options.accessible ?? true);
  const detectRaspberryPi = () => options.onPi ?? true;
  return { plugin: new RaspberryPiGpioPlugin(gpioPort, detectRaspberryPi), gpioPort };
}

describe("RaspberryPiGpioPlugin.discover()", () => {
  it("encuentra el dispositivo fijo cuando corre en una Pi con GPIO accesible", async () => {
    const { plugin: p } = plugin({ onPi: true, accessible: true });

    const found = await p.discover();

    expect(found).toEqual([{ id: DEVICE_ID, name: "Raspberry Pi (GPIO)", kind: "raspberry-pi" }]);
  });

  it("no encuentra nada si no corre en una Raspberry Pi", async () => {
    const { plugin: p } = plugin({ onPi: false, accessible: true });

    expect(await p.discover()).toEqual([]);
  });

  it("no encuentra nada si el GPIO no es accesible (sysfs no disponible/sin permisos)", async () => {
    const { plugin: p } = plugin({ onPi: true, accessible: false });

    expect(await p.discover()).toEqual([]);
  });
});

describe("RaspberryPiGpioPlugin.invoke()", () => {
  it("write_digital_pin escribe el valor en el pin real", async () => {
    const { plugin: p, gpioPort } = plugin();

    const result = await p.invoke(DEVICE_ID, "write_digital_pin", { pin: 17, value: true });

    expect(result).toEqual({ success: true, data: { pin: 17, value: true } });
    expect(gpioPort.openedPins).toContain(17);
  });

  it("read_digital_pin lee el valor actual del pin", async () => {
    const { plugin: p, gpioPort } = plugin();
    gpioPort.setValue(4, true);

    const result = await p.invoke(DEVICE_ID, "read_digital_pin", { pin: 4 });

    expect(result).toEqual({ success: true, data: { pin: 4, value: true } });
  });

  it("rechaza un pin desconocido/no usable", async () => {
    const { plugin: p } = plugin();

    const result = await p.invoke(DEVICE_ID, "read_digital_pin", { pin: 2 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Pin desconocido/);
  });

  it("rechaza 'value' que no sea boolean en write_digital_pin", async () => {
    const { plugin: p } = plugin();

    const result = await p.invoke(DEVICE_ID, "write_digital_pin", { pin: 17, value: "on" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/boolean/);
  });

  it("rechaza un deviceId que no es el dispositivo fijo", async () => {
    const { plugin: p } = plugin();

    const result = await p.invoke("otro-dispositivo", "read_digital_pin", { pin: 17 });

    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: otro-dispositivo" });
  });

  it("rechaza una capability desconocida", async () => {
    const { plugin: p } = plugin();

    const result = await p.invoke(DEVICE_ID, "toggle_led", {});

    expect(result.success).toBe(false);
  });

  it("reabre la línea si se pide la dirección opuesta a la ya abierta en el mismo pin", async () => {
    const { plugin: p, gpioPort } = plugin();

    await p.invoke(DEVICE_ID, "write_digital_pin", { pin: 17, value: true });
    await p.invoke(DEVICE_ID, "read_digital_pin", { pin: 17 });

    // Se abrió para escritura y se volvió a abrir para lectura (direcciones distintas).
    expect(gpioPort.openedPins).toEqual([17, 17]);
    expect(gpioPort.closedPins).toEqual([17]);
  });
});

describe("RaspberryPiGpioPlugin.disconnect()", () => {
  it("cierra todas las líneas abiertas", async () => {
    const { plugin: p, gpioPort } = plugin();
    await p.invoke(DEVICE_ID, "write_digital_pin", { pin: 17, value: true });
    await p.invoke(DEVICE_ID, "write_digital_pin", { pin: 27, value: false });

    await p.disconnect(DEVICE_ID);

    expect(gpioPort.closedPins).toEqual(expect.arrayContaining([17, 27]));
  });
});

describe("RaspberryPiGpioPlugin.getCapabilities()/listTargets()", () => {
  it("declara read_digital_pin y write_digital_pin, sin analog/PWM", () => {
    const { plugin: p } = plugin();

    const names = p.getCapabilities(DEVICE_ID).map((c) => c.name);

    expect(names).toEqual(["read_digital_pin", "write_digital_pin"]);
  });

  it("lista todos los pines de propósito general con severidad irreversible-material por defecto", () => {
    const { plugin: p } = plugin();

    const targets = p.listTargets(DEVICE_ID);

    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.defaultSeverity === "irreversible-material")).toBe(true);
  });
});
