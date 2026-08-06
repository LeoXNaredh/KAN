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
});
