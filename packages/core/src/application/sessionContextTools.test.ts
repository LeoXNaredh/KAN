import { describe, expect, it, vi } from "vitest";
import {
  SESSION_CONTEXT_TOOL_DESCRIPTORS,
  isSessionContextToolName,
  executeSessionContextTool,
} from "./sessionContextTools";
import type { SessionContextPort } from "../domain/ports/SessionContextPort";

function fakeSessionContext(overrides: Partial<SessionContextPort> = {}): SessionContextPort {
  return {
    getActiveDevice: async () => undefined,
    setActiveDevice: async () => {},
    getActiveProject: async () => undefined,
    setActiveProject: async () => {},
    getCurrentTask: async () => undefined,
    setCurrentTask: async () => {},
    clear: async () => {},
    ...overrides,
  };
}

describe("isSessionContextToolName", () => {
  it("reconoce los tres nombres de tool de contexto de sesión y ningún otro", () => {
    expect(isSessionContextToolName("kan_set_active_device")).toBe(true);
    expect(isSessionContextToolName("kan_set_active_project")).toBe(true);
    expect(isSessionContextToolName("kan_set_current_task")).toBe(true);
    expect(isSessionContextToolName("kan_set_memory")).toBe(false);
    expect(isSessionContextToolName("read_sensor")).toBe(false);
  });
});

describe("SESSION_CONTEXT_TOOL_DESCRIPTORS", () => {
  it("declara los tres tools de contexto de sesión", () => {
    const names = SESSION_CONTEXT_TOOL_DESCRIPTORS.map((t) => t.name);
    expect(names).toEqual(["kan_set_active_device", "kan_set_active_project", "kan_set_current_task"]);
  });
});

describe("executeSessionContextTool", () => {
  it("kan_set_active_device llama sessionContext.setActiveDevice y devuelve el valor guardado", async () => {
    const sessionContext = fakeSessionContext();
    const setSpy = vi.spyOn(sessionContext, "setActiveDevice");

    const result = await executeSessionContextTool(sessionContext, "kan_set_active_device", { deviceId: "ESP32-01" });

    expect(setSpy).toHaveBeenCalledWith("ESP32-01");
    expect(result).toEqual({ success: true, data: { activeDevice: "ESP32-01" } });
  });

  it("kan_set_active_project llama sessionContext.setActiveProject", async () => {
    const sessionContext = fakeSessionContext();
    const setSpy = vi.spyOn(sessionContext, "setActiveProject");

    const result = await executeSessionContextTool(sessionContext, "kan_set_active_project", {
      projectId: "Robot autónomo",
    });

    expect(setSpy).toHaveBeenCalledWith("Robot autónomo");
    expect(result).toEqual({ success: true, data: { activeProject: "Robot autónomo" } });
  });

  it("kan_set_current_task llama sessionContext.setCurrentTask", async () => {
    const sessionContext = fakeSessionContext();
    const setSpy = vi.spyOn(sessionContext, "setCurrentTask");

    const result = await executeSessionContextTool(sessionContext, "kan_set_current_task", {
      task: "calibrar el sensor de temperatura",
    });

    expect(setSpy).toHaveBeenCalledWith("calibrar el sensor de temperatura");
    expect(result).toEqual({ success: true, data: { currentTask: "calibrar el sensor de temperatura" } });
  });

  it("rechaza kan_set_active_device sin deviceId", async () => {
    const sessionContext = fakeSessionContext();
    const setSpy = vi.spyOn(sessionContext, "setActiveDevice");

    const result = await executeSessionContextTool(sessionContext, "kan_set_active_device", {});

    expect(result.success).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("rechaza con un valor vacío/solo espacios", async () => {
    const sessionContext = fakeSessionContext();

    const result = await executeSessionContextTool(sessionContext, "kan_set_current_task", { task: "   " });

    expect(result.success).toBe(false);
  });

  it("devuelve error para un nombre de tool desconocido", async () => {
    const sessionContext = fakeSessionContext();

    const result = await executeSessionContextTool(sessionContext, "kan_otra_cosa", {});

    expect(result).toEqual({ success: false, error: "Tool de contexto de sesión desconocida: kan_otra_cosa" });
  });
});
