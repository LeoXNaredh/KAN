import { describe, expect, it } from "vitest";
import { defaultSeverityForEntity, domainOf } from "./entityDomain";

describe("entityDomain", () => {
  it("domainOf extrae la parte antes del punto", () => {
    expect(domainOf("light.living_room")).toBe("light");
    expect(domainOf("lock.front_door")).toBe("lock");
  });

  it("domainOf sin punto devuelve el string entero", () => {
    expect(domainOf("sin_punto")).toBe("sin_punto");
  });

  it("lock/alarm_control_panel son safety-critical", () => {
    expect(defaultSeverityForEntity("lock.front_door")).toBe("safety-critical");
    expect(defaultSeverityForEntity("alarm_control_panel.home")).toBe("safety-critical");
  });

  it("switch/light/climate/cover/fan son irreversible-material", () => {
    expect(defaultSeverityForEntity("switch.garage")).toBe("irreversible-material");
    expect(defaultSeverityForEntity("light.living_room")).toBe("irreversible-material");
    expect(defaultSeverityForEntity("climate.thermostat")).toBe("irreversible-material");
    expect(defaultSeverityForEntity("cover.garage_door")).toBe("irreversible-material");
    expect(defaultSeverityForEntity("fan.bedroom")).toBe("irreversible-material");
  });

  it("dominios sin clasificar (sensor, person, sun) son read-only", () => {
    expect(defaultSeverityForEntity("sensor.temperature")).toBe("read-only");
    expect(defaultSeverityForEntity("binary_sensor.motion")).toBe("read-only");
    expect(defaultSeverityForEntity("person.juan")).toBe("read-only");
    expect(defaultSeverityForEntity("sun.sun")).toBe("read-only");
  });
});
