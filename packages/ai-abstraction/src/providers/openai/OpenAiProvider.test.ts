import { describe, expect, it, vi, afterEach } from "vitest";
import type { Message } from "@kan/core";
import { OpenAiProvider, toOpenAiMessages, toOpenAiTool } from "./OpenAiProvider";

describe("OpenAiProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function fakeResponse(body: unknown, overrides: Partial<Response> = {}) {
    return { ok: true, json: async () => body, ...overrides };
  }

  it("lanza si falta la API key", () => {
    expect(() => new OpenAiProvider({ apiKey: "" })).toThrow(/falta la API key/);
  });

  it("chat() manda el modelo, el systemPrompt como primer mensaje 'system', y los mensajes mapeados", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ choices: [{ message: { content: "hola" } }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiProvider({ apiKey: "test-key" });
    const messages: Message[] = [{ id: "m1", role: "user", content: "hola KAN", createdAt: "2026-01-01T00:00:00.000Z" }];
    await provider.chat({ messages, systemPrompt: "sos KAN" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toEqual([
      { role: "system", content: "sos KAN" },
      { role: "user", content: "hola KAN" },
    ]);
  });

  it("sin systemPrompt, no agrega mensaje 'system'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ choices: [{ message: { content: "ok" } }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiProvider({ apiKey: "test-key" });
    await provider.chat({ messages: [] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([]);
  });

  it("usa el modelo custom si se especifica", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ choices: [{ message: { content: "ok" } }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiProvider({ apiKey: "test-key", model: "gpt-4o-mini" });
    await provider.chat({ messages: [] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("chat() devuelve content cuando la respuesta es solo texto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ choices: [{ message: { content: "hola, ¿en qué te ayudo?" } }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiProvider({ apiKey: "test-key" });
    const result = await provider.chat({ messages: [] });

    expect(result).toEqual({ content: "hola, ¿en qué te ayudo?" });
  });

  it("chat() devuelve toolCalls parseando los argumentos JSON, con providerMetadata = id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "call_abc", type: "function", function: { name: "read_sensor", arguments: '{"unit":"celsius"}' } },
              ],
            },
          },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiProvider({ apiKey: "test-key" });
    const result = await provider.chat({ messages: [] });

    expect(result).toEqual({
      toolCalls: [{ name: "read_sensor", args: { unit: "celsius" }, providerMetadata: "call_abc" }],
    });
  });

  it("lanza con el status y el cuerpo si OpenAI responde con error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limit exceeded",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiProvider({ apiKey: "test-key" });

    await expect(provider.chat({ messages: [] })).rejects.toThrow(/429.*rate limit exceeded/);
  });
});

describe("toOpenAiMessages", () => {
  it("mapea un mensaje de usuario a content string plano", () => {
    const message: Message = { id: "m1", role: "user", content: "hola", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toOpenAiMessages([message])).toEqual([{ role: "user", content: "hola" }]);
  });

  it("mapea un mensaje de usuario con imagen a content array con image_url en formato data URI", () => {
    const message: Message = {
      id: "m2",
      role: "user",
      content: "¿qué es esto?",
      createdAt: "2026-01-01T00:00:00.000Z",
      image: { data: "ZmFrZQ==", mimeType: "image/png" },
    };
    expect(toOpenAiMessages([message])).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "¿qué es esto?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } },
        ],
      },
    ]);
  });

  it("mapea un mensaje assistant con toolCall a tool_calls con arguments como string JSON", () => {
    const message: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: { unit: "celsius" } },
    };
    expect(toOpenAiMessages([message])).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_0", type: "function", function: { name: "read_sensor", arguments: '{"unit":"celsius"}' } },
        ],
      },
    ]);
  });

  it("reusa el id de providerMetadata si ya existe", () => {
    const message: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: {}, providerMetadata: "call_original" },
    };
    const [mapped] = toOpenAiMessages([message]);
    expect(mapped.tool_calls?.[0].id).toBe("call_original");
  });

  it("mapea un mensaje tool a role tool con tool_call_id apuntando al id del toolCall anterior", () => {
    const assistantMessage: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: {}, providerMetadata: "call_abc" },
    };
    const toolMessage: Message = {
      id: "m4",
      role: "tool",
      content: "Resultado: 23",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolResult: { name: "read_sensor", success: true, data: { temperatureC: 23 } },
    };
    const [, mapped] = toOpenAiMessages([assistantMessage, toolMessage]);
    expect(mapped).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: JSON.stringify(toolMessage.toolResult),
    });
  });
});

describe("toOpenAiTool", () => {
  it("mapea un ToolDescriptor a la forma function-calling de OpenAI", () => {
    expect(
      toOpenAiTool({
        name: "move_axis",
        description: "Mueve un eje",
        inputSchema: { type: "object", properties: { distanceMm: { type: "number" } }, required: ["distanceMm"] },
      }),
    ).toEqual({
      type: "function",
      function: {
        name: "move_axis",
        description: "Mueve un eje",
        parameters: { type: "object", properties: { distanceMm: { type: "number" } }, required: ["distanceMm"] },
      },
    });
  });

  it("usa parameters vacío en vez de undefined cuando la tool no tiene parámetros", () => {
    const tool = toOpenAiTool({ name: "get_status", description: "Estado", inputSchema: {} });
    expect(tool.function.parameters).toEqual({ type: "object", properties: {} });
  });
});
