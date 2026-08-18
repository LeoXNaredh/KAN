import { describe, expect, it } from "vitest";
import { SendMessageUseCase, type ChatStreamEvent } from "./SendMessageUseCase";
import { InMemoryConversationRepository } from "../../infra/InMemoryConversationRepository";
import type { AIProviderPort, ChatRequest, ChatResponse } from "../../domain/ports/AIProviderPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { MemoryEntry } from "../../domain/entities/MemoryEntry";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";
import type { SessionContextPort } from "../../domain/ports/SessionContextPort";

class ScriptedAIProvider implements AIProviderPort {
  readonly providerName = "scripted";
  private callIndex = 0;
  readonly requestsSeen: ChatRequest[] = [];

  constructor(private readonly responses: ChatResponse[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requestsSeen.push(request);
    const response = this.responses[this.callIndex];
    this.callIndex += 1;
    return response ?? { content: "" };
  }
}

class FakeToolProvider implements ToolProviderPort {
  executedCalls: Array<{ name: string; args: unknown }> = [];
  resolvedConfirmations: Array<{ confirmationId: string; approved: boolean }> = [];
  confirmationResult: ToolExecutionResult = { success: true, data: {} };

  constructor(
    private readonly tools: ToolDescriptor[],
    private readonly result: ToolExecutionResult,
  ) {}

  async listTools(): Promise<ToolDescriptor[]> {
    return this.tools;
  }

  async executeTool(name: string, args: unknown): Promise<ToolExecutionResult> {
    this.executedCalls.push({ name, args });
    return this.result;
  }

  async resolveConfirmation(confirmationId: string, approved: boolean): Promise<ToolExecutionResult> {
    this.resolvedConfirmations.push({ confirmationId, approved });
    return this.confirmationResult;
  }
}

describe("SendMessageUseCase", () => {
  it("responde con texto plano cuando el LLM no propone ninguna tool", async () => {
    const ai = new ScriptedAIProvider([{ content: "Hola, ¿en qué te ayudo?" }]);
    const repo = new InMemoryConversationRepository();
    const useCase = new SendMessageUseCase(ai, repo);

    const { conversation } = await useCase.execute({ userMessage: "hola" });

    expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1].content).toBe("Hola, ¿en qué te ayudo?");
  });

  it("el system prompt pide hablar en español rioplatense (voseo), no neutro ni de España (ADR-060)", async () => {
    const ai = new ScriptedAIProvider([{ content: "listo" }]);
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository());

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).toMatch(/rioplatense/i);
    expect(ai.requestsSeen[0].systemPrompt).toMatch(/voseo/i);
  });

  it("ejecuta una tool propuesta y produce la respuesta final tras el resultado", async () => {
    const ai = new ScriptedAIProvider([
      { toolCalls: [{ name: "read_sensor", args: {} }] },
      { content: "El sensor marca 23°C." },
    ]);
    const toolProvider = new FakeToolProvider(
      [{ name: "read_sensor", description: "...", inputSchema: {} }],
      { success: true, data: { temperatureC: 23 } },
    );
    const repo = new InMemoryConversationRepository();
    const useCase = new SendMessageUseCase(ai, repo, toolProvider);

    const { conversation } = await useCase.execute({ userMessage: "lee el sensor" });

    expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(conversation.messages[1].toolCall).toEqual({ name: "read_sensor", args: {} });
    expect(conversation.messages[2].toolResult).toMatchObject({ name: "read_sensor", success: true });
    expect(conversation.messages[3].content).toBe("El sensor marca 23°C.");
    expect(toolProvider.executedCalls).toEqual([{ name: "read_sensor", args: {} }]);
  });

  it("emite tool_call -> tool_result -> final en orden vía onEvent (ADR-027, docs/16 P7)", async () => {
    const ai = new ScriptedAIProvider([
      { toolCalls: [{ name: "read_sensor", args: { unit: "celsius" } }] },
      { content: "El sensor marca 23°C." },
    ]);
    const toolProvider = new FakeToolProvider(
      [{ name: "read_sensor", description: "...", inputSchema: {} }],
      { success: true, data: { temperatureC: 23 } },
    );
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);
    const events: ChatStreamEvent[] = [];

    await useCase.execute({ userMessage: "lee el sensor" }, (event) => events.push(event));

    expect(events).toEqual([
      { type: "tool_call", name: "read_sensor", args: { unit: "celsius" } },
      { type: "tool_result", name: "read_sensor", success: true, data: { temperatureC: 23 }, error: undefined },
      { type: "final", content: "El sensor marca 23°C." },
    ]);
  });

  it("sin onEvent, el comportamiento es idéntico a no pasarlo (aditivo, no rompe llamadas existentes)", async () => {
    const ai = new ScriptedAIProvider([{ content: "hola" }]);
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository());

    const { conversation } = await useCase.execute({ userMessage: "hola" });

    expect(conversation.messages.at(-1)?.content).toBe("hola");
  });

  it("emite un evento final también en el fallback de MAX_TOOL_ROUNDS, con el mismo texto persistido", async () => {
    const alwaysToolCalls = Array.from({ length: 10 }, () => ({
      toolCalls: [{ name: "read_sensor", args: {} }],
    }));
    const ai = new ScriptedAIProvider(alwaysToolCalls);
    const toolProvider = new FakeToolProvider(
      [{ name: "read_sensor", description: "...", inputSchema: {} }],
      { success: true, data: {} },
    );
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);
    const events: ChatStreamEvent[] = [];

    const { conversation } = await useCase.execute({ userMessage: "hola" }, (event) => events.push(event));

    const finalEvent = events.at(-1);
    expect(finalEvent).toEqual({ type: "final", content: conversation.messages.at(-1)?.content });
  });

  it("pasa el catálogo de tools al proveedor de IA en cada ronda", async () => {
    const tools: ToolDescriptor[] = [{ name: "read_sensor", description: "...", inputSchema: {} }];
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const toolProvider = new FakeToolProvider(tools, { success: true });
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].tools).toEqual(tools);
  });

  it("si el ToolProvider no está configurado, no se pasan tools y el chat funciona igual", async () => {
    const ai = new ScriptedAIProvider([{ content: "respuesta sin tools" }]);
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository());

    const { conversation } = await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].tools).toBeUndefined();
    expect(conversation.messages.at(-1)?.content).toBe("respuesta sin tools");
  });

  it("si listTools() del Gateway falla, el chat sigue funcionando sin tools (no rompe)", async () => {
    const ai = new ScriptedAIProvider([{ content: "respuesta de todos modos" }]);
    const failingToolProvider: ToolProviderPort = {
      listTools: async () => {
        throw new Error("Gateway no disponible");
      },
      executeTool: async () => ({ success: false }),
      resolveConfirmation: async () => ({ success: false }),
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), failingToolProvider);

    const { conversation } = await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].tools).toBeUndefined();
    expect(conversation.messages.at(-1)?.content).toBe("respuesta de todos modos");
  });

  it("continúa una conversación existente por conversationId en vez de crear una nueva", async () => {
    const ai = new ScriptedAIProvider([{ content: "primera" }, { content: "segunda" }]);
    const repo = new InMemoryConversationRepository();
    const useCase = new SendMessageUseCase(ai, repo);

    const first = await useCase.execute({ userMessage: "hola" });
    const second = await useCase.execute({ userMessage: "otra vez", conversationId: first.conversation.id });

    expect(second.conversation.id).toBe(first.conversation.id);
    expect(second.conversation.messages).toHaveLength(4);
  });

  it("corta tras MAX_TOOL_ROUNDS y agrega un mensaje de fallback en vez de colgarse (hallazgo A11 de docs/13)", async () => {
    // El LLM siempre propone una tool call, nunca da una respuesta final.
    const alwaysToolCalls: ChatResponse[] = Array.from({ length: 10 }, () => ({
      toolCalls: [{ name: "read_sensor", args: {} }],
    }));
    const ai = new ScriptedAIProvider(alwaysToolCalls);
    const toolProvider = new FakeToolProvider(
      [{ name: "read_sensor", description: "...", inputSchema: {} }],
      { success: true, data: {} },
    );
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);

    const { conversation } = await useCase.execute({ userMessage: "hola" });

    const lastMessage = conversation.messages.at(-1);
    expect(lastMessage?.role).toBe("assistant");
    expect(lastMessage?.content).toMatch(/No pude completar/);
    // Como mucho 4 rondas (MAX_TOOL_ROUNDS): 1 user + 4*(assistant+tool) + 1 fallback = 10.
    expect(conversation.messages.length).toBeLessThanOrEqual(10);
  });

  it("inyecta hechos de memoria relevantes en el systemPrompt", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const memoryContext: MemoryContextPort = {
      listRelevant: async () => [
        { userId: "u1", category: "preferencia", key: "unidad_temperatura", value: "celsius", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      set: async (category, key, value) => ({ userId: "u1", category, key, value, updatedAt: "2026-01-01T00:00:00.000Z" }),
      remove: async () => {},
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, memoryContext);

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).toContain("unidad_temperatura");
  });

  it("kan_set_memory está disponible y se despacha sin ningún toolProvider configurado (ADR-035)", async () => {
    const ai = new ScriptedAIProvider([
      { toolCalls: [{ name: "kan_set_memory", args: { category: "dispositivos", key: "impresora_3d", value: "Ender 3" } }] },
      { content: "Listo, lo recordaré." },
    ]);
    const stored: MemoryEntry[] = [];
    const memoryContext: MemoryContextPort = {
      listRelevant: async () => stored,
      set: async (category, key, value) => {
        const entry: MemoryEntry = { userId: "u1", category, key, value, updatedAt: "2026-01-01T00:00:00.000Z" };
        stored.push(entry);
        return entry;
      },
      remove: async () => {},
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, memoryContext);

    const { conversation } = await useCase.execute({ userMessage: "recordá que mi impresora se llama Ender 3" });

    expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(conversation.messages[2].toolResult).toMatchObject({ name: "kan_set_memory", success: true });
    expect(stored).toHaveLength(1);
  });

  it("las tools de memoria se ofrecen al proveedor de IA cuando hay memoryContext, incluso sin toolProvider", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const memoryContext: MemoryContextPort = {
      listRelevant: async () => [],
      set: async (category, key, value) => ({ userId: "u1", category, key, value, updatedAt: "" }),
      remove: async () => {},
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, memoryContext);

    await useCase.execute({ userMessage: "hola" });

    const toolNames = ai.requestsSeen[0].tools?.map((t) => t.name);
    expect(toolNames).toEqual(["kan_set_memory", "kan_remove_memory"]);
  });

  it("una llamada a kan_set_memory nunca pasa por toolProvider.executeTool", async () => {
    const ai = new ScriptedAIProvider([
      { toolCalls: [{ name: "kan_set_memory", args: { category: "general", key: "k", value: "v" } }] },
      { content: "listo" },
    ]);
    const toolProvider = new FakeToolProvider([], { success: true });
    const memoryContext: MemoryContextPort = {
      listRelevant: async () => [],
      set: async (category, key, value) => ({ userId: "u1", category, key, value, updatedAt: "" }),
      remove: async () => {},
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider, memoryContext);

    await useCase.execute({ userMessage: "hola" });

    expect(toolProvider.executedCalls).toEqual([]);
  });

  it("inyecta la personalidad configurada en el systemPrompt", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const personalityContext: PersonalityContextPort = { getPersonality: async () => "Sé breve y directo, sin rodeos." };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, undefined, personalityContext);

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).toContain("Sé breve y directo, sin rodeos.");
  });

  it("si no hay personalidad configurada, el systemPrompt no la menciona", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const personalityContext: PersonalityContextPort = { getPersonality: async () => undefined };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, undefined, personalityContext);

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).not.toContain("personalidad");
  });

  it("si el store de personalidad falla, el chat sigue funcionando con el prompt por defecto", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const failingPersonalityContext: PersonalityContextPort = {
      getPersonality: async () => {
        throw new Error("db caída");
      },
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, undefined, failingPersonalityContext);

    const { conversation } = await useCase.execute({ userMessage: "hola" });

    expect(conversation.messages.at(-1)?.content).toBe("ok");
  });

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

  it("inyecta el contexto de sesión activo en el systemPrompt (ADR-055)", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const sessionContext = fakeSessionContext({
      getActiveDevice: async () => "ESP32-01",
      getActiveProject: async () => "Robot autónomo",
    });
    const useCase = new SendMessageUseCase(
      ai,
      new InMemoryConversationRepository(),
      undefined,
      undefined,
      undefined,
      sessionContext,
    );

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).toContain("Dispositivo activo: ESP32-01.");
    expect(ai.requestsSeen[0].systemPrompt).toContain("Proyecto activo: Robot autónomo.");
    expect(ai.requestsSeen[0].systemPrompt).not.toContain("Tarea actual:");
  });

  it("sin nada fijado en el contexto de sesión, el systemPrompt no menciona 'Contexto de la sesión'", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const useCase = new SendMessageUseCase(
      ai,
      new InMemoryConversationRepository(),
      undefined,
      undefined,
      undefined,
      fakeSessionContext(),
    );

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).not.toContain("Contexto de la sesión");
  });

  it("las tools de contexto de sesión se ofrecen al proveedor de IA cuando hay sessionContext, incluso sin toolProvider", async () => {
    const ai = new ScriptedAIProvider([{ content: "ok" }]);
    const useCase = new SendMessageUseCase(
      ai,
      new InMemoryConversationRepository(),
      undefined,
      undefined,
      undefined,
      fakeSessionContext(),
    );

    await useCase.execute({ userMessage: "hola" });

    const toolNames = ai.requestsSeen[0].tools?.map((t) => t.name);
    expect(toolNames).toEqual(["kan_set_active_device", "kan_set_active_project", "kan_set_current_task"]);
  });

  it("kan_set_active_device está disponible y se despacha sin ningún toolProvider configurado (ADR-055)", async () => {
    const ai = new ScriptedAIProvider([
      { toolCalls: [{ name: "kan_set_active_device", args: { deviceId: "ESP32-01" } }] },
      { content: "Listo, tomo nota." },
    ]);
    let stored: string | undefined;
    const sessionContext = fakeSessionContext({
      setActiveDevice: async (deviceId) => {
        stored = deviceId;
      },
    });
    const useCase = new SendMessageUseCase(
      ai,
      new InMemoryConversationRepository(),
      undefined,
      undefined,
      undefined,
      sessionContext,
    );

    const { conversation } = await useCase.execute({ userMessage: "estoy trabajando con el ESP32-01" });

    expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(conversation.messages[2].toolResult).toMatchObject({ name: "kan_set_active_device", success: true });
    expect(stored).toBe("ESP32-01");
  });

  it("una llamada a kan_set_current_task nunca pasa por toolProvider.executeTool", async () => {
    const ai = new ScriptedAIProvider([
      { toolCalls: [{ name: "kan_set_current_task", args: { task: "calibrar sensor" } }] },
      { content: "listo" },
    ]);
    const toolProvider = new FakeToolProvider([], { success: true });
    const useCase = new SendMessageUseCase(
      ai,
      new InMemoryConversationRepository(),
      toolProvider,
      undefined,
      undefined,
      fakeSessionContext(),
    );

    await useCase.execute({ userMessage: "hola" });

    expect(toolProvider.executedCalls).toEqual([]);
  });

  describe("pending_confirmation y resume (ADR-059)", () => {
    it("un tool result con requiresConfirmation emite pending_confirmation y corta el turno sin mensaje final", async () => {
      const ai = new ScriptedAIProvider([{ toolCalls: [{ name: "move_arm", args: { angle: 30 } }] }]);
      const toolProvider = new FakeToolProvider(
        [{ name: "move_arm", description: "...", inputSchema: {} }],
        {
          success: false,
          requiresConfirmation: true,
          data: { confirmationId: "conf-1", deviceId: "arm-1", capabilityName: "move_arm", input: { angle: 30 }, severity: "irreversible-material" },
          error: "Esta acción requiere confirmación explícita antes de ejecutarse.",
        },
      );
      const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);
      const events: ChatStreamEvent[] = [];

      const { conversation } = await useCase.execute({ userMessage: "mové el brazo 30 grados" }, (event) => events.push(event));

      expect(events.at(-1)).toEqual({
        type: "pending_confirmation",
        confirmationId: "conf-1",
        deviceId: "arm-1",
        capabilityName: "move_arm",
        input: { angle: 30 },
        severity: "irreversible-material",
      });
      // Sin evento "final" ni mensaje assistant final — el turno queda en espera, no es una falla.
      expect(events.some((e) => e.type === "final")).toBe(false);
      expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
      expect(ai.requestsSeen).toHaveLength(1);
    });

    it("confirmationResponse con approved:true resuelve vía toolProvider.resolveConfirmation y continúa el loop", async () => {
      const ai = new ScriptedAIProvider([{ content: "Listo, moví el brazo 30 grados." }]);
      const toolProvider = new FakeToolProvider([], { success: true });
      toolProvider.confirmationResult = { success: true, data: { moved: true } };
      const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);
      const events: ChatStreamEvent[] = [];

      const { conversation } = await useCase.execute(
        { userMessage: "", confirmationResponse: { confirmationId: "conf-1", approved: true } },
        (event) => events.push(event),
      );

      expect(toolProvider.resolvedConfirmations).toEqual([{ confirmationId: "conf-1", approved: true }]);
      expect(conversation.messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
      expect(conversation.messages[0].toolCall).toEqual({ name: "confirm_pending_action", args: { confirmationId: "conf-1", approved: true } });
      expect(conversation.messages[1].toolResult).toMatchObject({ name: "confirm_pending_action", success: true, data: { moved: true } });
      expect(conversation.messages[2].content).toBe("Listo, moví el brazo 30 grados.");
      expect(events[0]).toEqual({ type: "tool_call", name: "confirm_pending_action", args: { confirmationId: "conf-1", approved: true } });
    });

    it("confirmationResponse con approved:false también resuelve y el modelo reacciona en lenguaje natural", async () => {
      const ai = new ScriptedAIProvider([{ content: "Entendido, no lo hago." }]);
      const toolProvider = new FakeToolProvider([], { success: true });
      toolProvider.confirmationResult = { success: false, error: "Rechazado por el usuario" };
      const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);

      const { conversation } = await useCase.execute({
        userMessage: "",
        confirmationResponse: { confirmationId: "conf-1", approved: false },
      });

      expect(toolProvider.resolvedConfirmations).toEqual([{ confirmationId: "conf-1", approved: false }]);
      expect(conversation.messages[1].toolResult).toMatchObject({ success: false, error: "Rechazado por el usuario" });
      expect(conversation.messages.at(-1)?.content).toBe("Entendido, no lo hago.");
    });

    it("el mensaje assistant sintético del resume mantiene la alternancia de roles (fix del bug de emparejamiento entre proveedores)", async () => {
      const ai = new ScriptedAIProvider([{ content: "ok" }]);
      const toolProvider = new FakeToolProvider([], { success: true });
      const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), toolProvider);

      const { conversation } = await useCase.execute({
        userMessage: "",
        confirmationResponse: { confirmationId: "conf-1", approved: true },
      });

      // Nunca dos mensajes "tool"/"user" consecutivos: el par assistant(toolCall) + tool(resultado) precede al resultado, igual que cualquier tool call real del loop.
      expect(conversation.messages[0].role).toBe("assistant");
      expect(conversation.messages[0].toolCall?.name).toBe("confirm_pending_action");
      expect(conversation.messages[1].role).toBe("tool");
    });

    it("sin toolProvider configurado, resume falla con un error claro en vez de lanzar", async () => {
      const ai = new ScriptedAIProvider([{ content: "no puedo confirmar eso" }]);
      const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository());

      const { conversation } = await useCase.execute({
        userMessage: "",
        confirmationResponse: { confirmationId: "conf-1", approved: true },
      });

      expect(conversation.messages[1].toolResult).toMatchObject({ success: false });
    });
  });
});
