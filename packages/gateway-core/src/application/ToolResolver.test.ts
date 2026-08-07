import { describe, expect, it } from "vitest";
import type { ToolDescriptor } from "@kan/plugin-contract";
import { RegistryToolResolver } from "./ToolResolver";
import type { ToolRegistry } from "./ToolRegistry";

function fakeRegistry(tools: ToolDescriptor[]): ToolRegistry {
  return {
    list: () => tools,
    get: (name) => tools.find((t) => t.name === name),
  };
}

describe("RegistryToolResolver", () => {
  it("resuelve una tool conocida", () => {
    const resolver = new RegistryToolResolver(
      fakeRegistry([{ name: "read_sensor", description: "...", inputSchema: {} }]),
    );

    const result = resolver.resolve("read_sensor", { foo: "bar" });
    expect(result).toEqual({ ok: true, call: { ref: "read_sensor", args: { foo: "bar" } } });
  });

  it("rechaza un nombre de tool que el LLM se inventó (hallazgo de seguridad: el proveedor solo propone)", () => {
    const resolver = new RegistryToolResolver(fakeRegistry([]));
    const result = resolver.resolve("tool_alucinada_por_el_llm", {});
    expect(result).toEqual({ ok: false, error: "Herramienta desconocida: tool_alucinada_por_el_llm" });
  });

  it("rechaza args que no cumplen el inputSchema (docs/16 P1 — primera capa de defensa en profundidad)", () => {
    const resolver = new RegistryToolResolver(
      fakeRegistry([
        {
          name: "move_axis",
          description: "...",
          inputSchema: {
            type: "object",
            properties: { distanceMm: { type: "number" } },
            required: ["distanceMm"],
          },
        },
      ]),
    );

    const result = resolver.resolve("move_axis", { distanceMm: "diez" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Argumentos inválidos/);
  });

  it("acepta args que sí cumplen el inputSchema", () => {
    const resolver = new RegistryToolResolver(
      fakeRegistry([
        {
          name: "move_axis",
          description: "...",
          inputSchema: {
            type: "object",
            properties: { distanceMm: { type: "number" } },
            required: ["distanceMm"],
          },
        },
      ]),
    );

    const result = resolver.resolve("move_axis", { distanceMm: 10 });
    expect(result).toEqual({ ok: true, call: { ref: "move_axis", args: { distanceMm: 10 } } });
  });
});
