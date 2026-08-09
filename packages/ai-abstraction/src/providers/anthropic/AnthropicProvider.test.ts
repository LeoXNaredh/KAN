import { describe, expect, it, vi, afterEach } from "vitest";
import type { Message } from "@kan/core";
import { AnthropicProvider, toAnthropicMessages, toAnthropicTool } from "./AnthropicProvider";

describe("AnthropicProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function fakeResponse(body: unknown, overrides: Partial<Response> = {}) {
    return { ok: true, json: async () => body, ...overrides };
  }

  it("lanza si falta la API key", () => {
    expect(() => new AnthropicProvider({ apiKey: "" })).toThrow(/falta la API key/);
  });

  it("chat() manda el modelo, max_tokens, system y los mensajes mapeados", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ content: [{ type: "text", text: "hola" }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const messages: Message[] = [{ id: "m1", role: "user", content: "hola KAN", createdAt: "2026-01-01T00:00:00.000Z" }];
    await provider.chat({ messages, systemPrompt: "sos KAN" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe("sos KAN");
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hola KAN" }] }]);
  });

  it("usa el modelo custom si se especifica", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ content: [{ type: "text", text: "ok" }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-opus-4-6" });
    await provider.chat({ messages: [] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("claude-opus-4-6");
  });

  it("chat() devuelve content cuando la respuesta es solo texto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ content: [{ type: "text", text: "hola, " }, { type: "text", text: "¿en qué te ayudo?" }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.chat({ messages: [] });

    expect(result).toEqual({ content: "hola, ¿en qué te ayudo?" });
  });

  it("chat() devuelve toolCalls con providerMetadata = id del tool_use", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        content: [{ type: "tool_use", id: "toolu_01ABC", name: "read_sensor", input: { unit: "celsius" } }],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const result = await provider.chat({ messages: [] });

    expect(result).toEqual({
      toolCalls: [{ name: "read_sensor", args: { unit: "celsius" }, providerMetadata: "toolu_01ABC" }],
    });
  });

  it("lanza con el status y el cuerpo si Anthropic responde con error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limit exceeded",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ apiKey: "test-key" });

    await expect(provider.chat({ messages: [] })).rejects.toThrow(/429.*rate limit exceeded/);
  });
});

describe("toAnthropicMessages", () => {
  it("mapea un mensaje de usuario a un bloque de texto", () => {
    const message: Message = { id: "m1", role: "user", content: "hola", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toAnthropicMessages([message])).toEqual([{ role: "user", content: [{ type: "text", text: "hola" }] }]);
  });

  it("mapea un mensaje de usuario con imagen a texto + bloque de imagen base64", () => {
    const message: Message = {
      id: "m2",
      role: "user",
      content: "¿qué es esto?",
      createdAt: "2026-01-01T00:00:00.000Z",
      image: { data: "ZmFrZQ==", mimeType: "image/png" },
    };
    expect(toAnthropicMessages([message])).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "¿qué es esto?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" } },
        ],
      },
    ]);
  });

  it("mapea un mensaje assistant con toolCall a un bloque tool_use, con id propio si no hay providerMetadata", () => {
    const message: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: { unit: "celsius" } },
    };
    expect(toAnthropicMessages([message])).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_0", name: "read_sensor", input: { unit: "celsius" } }],
      },
    ]);
  });

  it("reusa el id de providerMetadata si ya existe (ej. round-trip con el mismo Anthropic)", () => {
    const message: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: {}, providerMetadata: "toolu_original" },
    };
    const [mapped] = toAnthropicMessages([message]);
    expect(mapped.content[0]).toMatchObject({ id: "toolu_original" });
  });

  it("mapea un mensaje tool a role user con tool_result apuntando al id del toolCall anterior", () => {
    const assistantMessage: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: {}, providerMetadata: "toolu_01ABC" },
    };
    const toolMessage: Message = {
      id: "m4",
      role: "tool",
      content: "Resultado: 23",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolResult: { name: "read_sensor", success: true, data: { temperatureC: 23 } },
    };
    const [, mapped] = toAnthropicMessages([assistantMessage, toolMessage]);
    expect(mapped).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01ABC",
          content: JSON.stringify(toolMessage.toolResult),
          is_error: false,
        },
      ],
    });
  });

  it("marca is_error cuando el toolResult falló", () => {
    const assistantMessage: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "move_axis", args: {} },
    };
    const toolMessage: Message = {
      id: "m4",
      role: "tool",
      content: "Error",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolResult: { name: "move_axis", success: false, error: "puerto ocupado" },
    };
    const [, mapped] = toAnthropicMessages([assistantMessage, toolMessage]);
    expect(mapped.content[0]).toMatchObject({ is_error: true });
  });
});

describe("toAnthropicTool", () => {
  it("mapea un ToolDescriptor a la forma de Anthropic", () => {
    expect(
      toAnthropicTool({
        name: "move_axis",
        description: "Mueve un eje",
        inputSchema: { type: "object", properties: { distanceMm: { type: "number" } }, required: ["distanceMm"] },
      }),
    ).toEqual({
      name: "move_axis",
      description: "Mueve un eje",
      input_schema: { type: "object", properties: { distanceMm: { type: "number" } }, required: ["distanceMm"] },
    });
  });

  it("usa un input_schema vacío en vez de undefined cuando la tool no tiene parámetros", () => {
    const tool = toAnthropicTool({ name: "get_status", description: "Estado", inputSchema: {} });
    expect(tool.input_schema).toEqual({ type: "object", properties: {} });
  });
});
