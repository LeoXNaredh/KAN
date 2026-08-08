import { describe, expect, it, vi } from "vitest";
import { MEMORY_TOOL_DESCRIPTORS, isMemoryToolName, executeMemoryTool } from "./memoryTools";
import type { MemoryContextPort } from "../domain/ports/MemoryContextPort";

function fakeMemoryContext(overrides: Partial<MemoryContextPort> = {}): MemoryContextPort {
  return {
    listRelevant: async () => [],
    set: async (category, key, value) => ({
      userId: "u1",
      category,
      key,
      value,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    remove: async () => {},
    ...overrides,
  };
}

describe("isMemoryToolName", () => {
  it("reconoce los dos nombres de tool de memoria y ningún otro", () => {
    expect(isMemoryToolName("kan_set_memory")).toBe(true);
    expect(isMemoryToolName("kan_remove_memory")).toBe(true);
    expect(isMemoryToolName("read_sensor")).toBe(false);
  });
});

describe("MEMORY_TOOL_DESCRIPTORS", () => {
  it("declara kan_set_memory y kan_remove_memory con la taxonomía de categorías fija", () => {
    const names = MEMORY_TOOL_DESCRIPTORS.map((t) => t.name);
    expect(names).toEqual(["kan_set_memory", "kan_remove_memory"]);
    for (const tool of MEMORY_TOOL_DESCRIPTORS) {
      expect(tool.inputSchema.properties?.category?.enum).toEqual(["dispositivos", "preferencias", "proyectos", "general"]);
    }
  });
});

describe("executeMemoryTool", () => {
  it("kan_set_memory llama memoryContext.set con los args y devuelve el MemoryEntry", async () => {
    const memoryContext = fakeMemoryContext();
    const setSpy = vi.spyOn(memoryContext, "set");

    const result = await executeMemoryTool(memoryContext, "kan_set_memory", {
      category: "dispositivos",
      key: "impresora_3d",
      value: "Ender 3, en el taller",
    });

    expect(setSpy).toHaveBeenCalledWith("dispositivos", "impresora_3d", "Ender 3, en el taller");
    expect(result).toEqual({
      success: true,
      data: { userId: "u1", category: "dispositivos", key: "impresora_3d", value: "Ender 3, en el taller", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
  });

  it("kan_remove_memory llama memoryContext.remove y devuelve category/key", async () => {
    const memoryContext = fakeMemoryContext();
    const removeSpy = vi.spyOn(memoryContext, "remove");

    const result = await executeMemoryTool(memoryContext, "kan_remove_memory", {
      category: "dispositivos",
      key: "impresora_3d",
    });

    expect(removeSpy).toHaveBeenCalledWith("dispositivos", "impresora_3d");
    expect(result).toEqual({ success: true, data: { category: "dispositivos", key: "impresora_3d" } });
  });

  it("rechaza kan_set_memory con una categoría fuera de la taxonomía", async () => {
    const memoryContext = fakeMemoryContext();
    const setSpy = vi.spyOn(memoryContext, "set");

    const result = await executeMemoryTool(memoryContext, "kan_set_memory", {
      category: "otra-cosa",
      key: "x",
      value: "y",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/category/);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("rechaza kan_set_memory con key o value vacíos", async () => {
    const memoryContext = fakeMemoryContext();

    const result = await executeMemoryTool(memoryContext, "kan_set_memory", {
      category: "general",
      key: "  ",
      value: "algo",
    });

    expect(result.success).toBe(false);
  });

  it("rechaza kan_remove_memory sin key", async () => {
    const memoryContext = fakeMemoryContext();

    const result = await executeMemoryTool(memoryContext, "kan_remove_memory", { category: "general" });

    expect(result.success).toBe(false);
  });

  it("devuelve error para un nombre de tool desconocido", async () => {
    const memoryContext = fakeMemoryContext();

    const result = await executeMemoryTool(memoryContext, "kan_otra_cosa", {});

    expect(result).toEqual({ success: false, error: "Tool de memoria desconocida: kan_otra_cosa" });
  });
});
