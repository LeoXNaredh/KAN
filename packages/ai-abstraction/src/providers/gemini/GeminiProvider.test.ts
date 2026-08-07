import { describe, expect, it } from "vitest";
import type { Message } from "@kan/core";
import { toGeminiContent, toFunctionDeclaration } from "./GeminiProvider";

describe("toGeminiContent", () => {
  it("mapea un mensaje de usuario a role 'user'", () => {
    const message: Message = { id: "m1", role: "user", content: "hola", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toGeminiContent(message)).toEqual({ role: "user", parts: [{ text: "hola" }] });
  });

  it("mapea un mensaje assistant sin toolCall a role 'model' con texto", () => {
    const message: Message = { id: "m2", role: "assistant", content: "respuesta", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toGeminiContent(message)).toEqual({ role: "model", parts: [{ text: "respuesta" }] });
  });

  it("mapea un mensaje assistant CON toolCall a un functionCall part (no texto plano)", () => {
    const message: Message = {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolCall: { name: "read_sensor", args: { unit: "celsius" } },
    };
    expect(toGeminiContent(message)).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "read_sensor", args: { unit: "celsius" } } }],
    });
  });

  it("mapea un mensaje de usuario CON imagen a un part de texto + inlineData (P3, ADR-018)", () => {
    const message: Message = {
      id: "m5",
      role: "user",
      content: "¿qué dispositivo es este?",
      createdAt: "2026-01-01T00:00:00.000Z",
      image: { data: "ZmFrZS1iYXNlNjQ=", mimeType: "image/png" },
    };
    expect(toGeminiContent(message)).toEqual({
      role: "user",
      parts: [
        { text: "¿qué dispositivo es este?" },
        { inlineData: { mimeType: "image/png", data: "ZmFrZS1iYXNlNjQ=" } },
      ],
    });
  });

  it("mapea un mensaje 'tool' a role 'user' con functionResponse (la API rechaza role 'function')", () => {
    const message: Message = {
      id: "m4",
      role: "tool",
      content: "Resultado: 23",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolResult: { name: "read_sensor", success: true, data: { temperatureC: 23 } },
    };
    const content = toGeminiContent(message);
    expect(content.role).toBe("user");
    expect(content.parts?.[0]).toMatchObject({
      functionResponse: { name: "read_sensor", response: { result: { name: "read_sensor", success: true, data: { temperatureC: 23 } } } },
    });
  });
});

describe("toFunctionDeclaration", () => {
  it("produce un nombre válido para el SDK (solo [a-zA-Z0-9_-], generado por GlobalCapabilityRegistry)", () => {
    const declaration = toFunctionDeclaration({
      name: "f85e7dc5_simulator-1_read_sensor",
      description: "Lee un sensor",
      inputSchema: {},
    });
    expect(declaration.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(declaration.parametersJsonSchema).toBeUndefined();
  });

  it("pasa el inputSchema (JSON Schema real, docs/16 P1) tal cual a Gemini", () => {
    const declaration = toFunctionDeclaration({
      name: "move_axis",
      description: "Mueve un eje",
      inputSchema: {
        type: "object",
        properties: { distanceMm: { type: "number" } },
        required: ["distanceMm"],
      },
    });
    expect(declaration.parametersJsonSchema).toEqual({
      type: "object",
      properties: { distanceMm: { type: "number" } },
      required: ["distanceMm"],
    });
  });
});
