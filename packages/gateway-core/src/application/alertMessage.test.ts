import { describe, expect, it } from "vitest";
import { describeAlertTriggered } from "./alertMessage";
import type { AlertRule } from "../domain/entities/AlertRule";

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "alert-1",
    capabilityRef: "c_agent1_simulator1_read_sensor",
    field: "temperatureC",
    comparator: "above",
    threshold: 40,
    label: "la temperatura",
    unit: "grados",
    createdAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("describeAlertTriggered", () => {
  it("arma el mensaje exacto del requisito: valor entero, comparador 'above'", () => {
    expect(describeAlertTriggered(rule(), 43)).toBe(
      "La temperatura llegó a 43 grados, superó el límite que definiste de 40.",
    );
  });

  it("comparador 'below' usa 'bajó del límite', sin repetir la unidad en el umbral", () => {
    const r = rule({ comparator: "below", threshold: 20, label: "el nivel de batería", unit: "%" });
    expect(describeAlertTriggered(r, 15)).toBe(
      "El nivel de batería llegó a 15 %, bajó del límite que definiste de 20.",
    );
  });

  it("sin unidad, no agrega nada extra", () => {
    const r = rule({ unit: undefined, label: "la presión" });
    expect(describeAlertTriggered(r, 45)).toBe("La presión llegó a 45, superó el límite que definiste de 40.");
  });

  it("redondea a un decimal cuando el valor no es entero", () => {
    expect(describeAlertTriggered(rule(), 43.456)).toBe(
      "La temperatura llegó a 43.5 grados, superó el límite que definiste de 40.",
    );
  });

  it("capitaliza solo la primera letra del label, preserva el resto", () => {
    const r = rule({ label: "la temperatura del motor" });
    expect(describeAlertTriggered(r, 90)).toMatch(/^La temperatura del motor /);
  });
});
