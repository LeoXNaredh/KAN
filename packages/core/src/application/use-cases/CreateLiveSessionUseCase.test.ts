import { describe, expect, it } from "vitest";
import { CreateLiveSessionUseCase } from "./CreateLiveSessionUseCase";
import type { LiveSessionConfig, LiveSessionPort } from "../../domain/ports/LiveSessionPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { MemoryEntry } from "../../domain/entities/MemoryEntry";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";
import type { ToolDescriptor } from "@kan/plugin-contract";
import { MEMORY_TOOL_DESCRIPTORS } from "../memoryTools";

const FAKE_CONFIG: LiveSessionConfig = {
  model: "gemini-2.5-flash-live-preview",
  wsUrl: "wss://generativelanguage.googleapis.com/ws/x",
  token: "tok-123",
  expiresAt: "2026-01-01T00:00:00.000Z",
};

class RecordingLiveSessionPort implements LiveSessionPort {
  calls: Array<{ systemPrompt: string; tools: ToolDescriptor[] }> = [];

  async createSession(systemPrompt: string, tools: ToolDescriptor[]): Promise<LiveSessionConfig> {
    this.calls.push({ systemPrompt, tools });
    return FAKE_CONFIG;
  }
}

class FakeToolProvider implements ToolProviderPort {
  constructor(private readonly tools: ToolDescriptor[] | (() => Promise<ToolDescriptor[]>)) {}
  async listTools(): Promise<ToolDescriptor[]> {
    if (typeof this.tools === "function") return this.tools();
    return this.tools;
  }
  async executeTool(): Promise<never> {
    throw new Error("no debería llamarse en este use case");
  }
}

class FakeMemoryContext implements MemoryContextPort {
  constructor(private readonly entries: MemoryEntry[]) {}
  async listRelevant(): Promise<MemoryEntry[]> {
    return this.entries;
  }
  async set(): Promise<MemoryEntry> {
    throw new Error("no usado en este test");
  }
  async remove(): Promise<void> {}
}

class FakePersonalityContext implements PersonalityContextPort {
  constructor(private readonly personality: string | undefined) {}
  async getPersonality(): Promise<string | undefined> {
    return this.personality;
  }
}

describe("CreateLiveSessionUseCase", () => {
  it("devuelve la config de sesión tal cual la da el puerto", async () => {
    const port = new RecordingLiveSessionPort();
    const useCase = new CreateLiveSessionUseCase(port);

    const config = await useCase.execute();

    expect(config).toEqual(FAKE_CONFIG);
  });

  it("sin toolProvider ni contexto, arma un system prompt base y tools vacío", async () => {
    const port = new RecordingLiveSessionPort();
    const useCase = new CreateLiveSessionUseCase(port);

    await useCase.execute();

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].tools).toEqual([]);
    expect(port.calls[0].systemPrompt).toContain("KAN");
    expect(port.calls[0].systemPrompt).toContain("Fecha y hora actual");
  });

  it("el system prompt pide explícitamente evitar markdown/formato (se lee en voz alta)", async () => {
    const port = new RecordingLiveSessionPort();
    const useCase = new CreateLiveSessionUseCase(port);

    await useCase.execute();

    expect(port.calls[0].systemPrompt).toMatch(/markdown/i);
  });

  it("junta las tools del Gateway con las de memoria (mismo criterio que SendMessageUseCase)", async () => {
    const port = new RecordingLiveSessionPort();
    const gatewayTool: ToolDescriptor = { name: "read_sensor", description: "...", inputSchema: {} };
    const toolProvider = new FakeToolProvider([gatewayTool]);
    const memoryContext = new FakeMemoryContext([]);
    const useCase = new CreateLiveSessionUseCase(port, toolProvider, memoryContext);

    await useCase.execute();

    const toolNames = port.calls[0].tools.map((t) => t.name);
    expect(toolNames).toContain("read_sensor");
    for (const memoryTool of MEMORY_TOOL_DESCRIPTORS) {
      expect(toolNames).toContain(memoryTool.name);
    }
  });

  it("si el Gateway falla al listar tools, degrada a sin tools de Gateway (no rompe la sesión)", async () => {
    const port = new RecordingLiveSessionPort();
    const toolProvider = new FakeToolProvider(() => {
      throw new Error("Gateway caído");
    });
    const useCase = new CreateLiveSessionUseCase(port, toolProvider);

    await expect(useCase.execute()).resolves.toEqual(FAKE_CONFIG);
    expect(port.calls[0].tools).toEqual([]);
  });

  it("incluye la personalidad configurada en el system prompt", async () => {
    const port = new RecordingLiveSessionPort();
    const personalityContext = new FakePersonalityContext("Sé directo y breve, sin rodeos.");
    const useCase = new CreateLiveSessionUseCase(port, undefined, undefined, personalityContext);

    await useCase.execute();

    expect(port.calls[0].systemPrompt).toContain("Sé directo y breve, sin rodeos.");
  });

  it("incluye la memoria relevante en el system prompt", async () => {
    const port = new RecordingLiveSessionPort();
    const memoryContext = new FakeMemoryContext([
      { userId: "u1", category: "dispositivo", key: "impresora", value: "Ender 3", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const useCase = new CreateLiveSessionUseCase(port, undefined, memoryContext);

    await useCase.execute();

    expect(port.calls[0].systemPrompt).toContain("Ender 3");
  });

  it("si personalityContext/memoryContext fallan, no rompe — sigue con el prompt base", async () => {
    const port = new RecordingLiveSessionPort();
    const failingPersonality: PersonalityContextPort = {
      getPersonality: () => Promise.reject(new Error("db caída")),
    };
    const failingMemory: MemoryContextPort = {
      listRelevant: () => Promise.reject(new Error("db caída")),
      set: () => Promise.reject(new Error("no usado")),
      remove: () => Promise.reject(new Error("no usado")),
    };
    const useCase = new CreateLiveSessionUseCase(port, undefined, failingMemory, failingPersonality);

    await expect(useCase.execute()).resolves.toEqual(FAKE_CONFIG);
  });
});
