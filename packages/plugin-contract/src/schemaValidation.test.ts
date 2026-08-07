import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "./schemaValidation";

describe("validateAgainstSchema", () => {
  it("acepta cualquier input si no hay schema", () => {
    expect(validateAgainstSchema(undefined, { lo: "que sea" })).toEqual({ ok: true });
  });

  it("acepta cualquier input si el schema está vacío (capability sin parámetros)", () => {
    expect(validateAgainstSchema({}, "cualquier cosa")).toEqual({ ok: true });
  });

  it("acepta un input que cumple el schema", () => {
    const schema = {
      type: "object" as const,
      properties: { distanceMm: { type: "number" as const } },
      required: ["distanceMm"],
    };
    expect(validateAgainstSchema(schema, { distanceMm: 10 })).toEqual({ ok: true });
  });

  it("rechaza un campo requerido ausente", () => {
    const schema = {
      type: "object" as const,
      properties: { on: { type: "boolean" as const } },
      required: ["on"],
    };
    const result = validateAgainstSchema(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Argumentos inválidos/);
  });

  it("rechaza un tipo incorrecto", () => {
    const schema = {
      type: "object" as const,
      properties: { pin: { type: "number" as const } },
      required: ["pin"],
    };
    const result = validateAgainstSchema(schema, { pin: "5" });
    expect(result.ok).toBe(false);
  });

  it("rechaza un input que no es un objeto cuando el schema exige type: object", () => {
    const schema = { type: "object" as const, properties: {}, required: [] };
    const result = validateAgainstSchema(schema, "no soy un objeto");
    expect(result.ok).toBe(false);
  });

  it("no falla con input undefined contra un schema sin propiedades requeridas", () => {
    const schema = { type: "object" as const, properties: { qos: { type: "number" as const } } };
    expect(validateAgainstSchema(schema, {})).toEqual({ ok: true });
  });
});
