import { describe, expect, it } from "vitest";
import { SendMessageUseCase } from "./SendMessageUseCase";
import { InMemoryConversationRepository } from "../../infra/InMemoryConversationRepository";
import type { AIProviderPort, ChatRequest, ChatResponse } from "../../domain/ports/AIProviderPort";
import type { ToolProviderPort } from "../../domain/ports/ToolProviderPort";
import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";
import type { MemoryContextPort } from "../../domain/ports/MemoryContextPort";
import type { PersonalityContextPort } from "../../domain/ports/PersonalityContextPort";

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
    };
    const useCase = new SendMessageUseCase(ai, new InMemoryConversationRepository(), undefined, memoryContext);

    await useCase.execute({ userMessage: "hola" });

    expect(ai.requestsSeen[0].systemPrompt).toContain("unidad_temperatura");
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
});
