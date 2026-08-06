import { describe, expect, it } from "vitest";
import { SchemaType } from "@google/generative-ai";
import type { Message } from "@kan/core";
import { toGeminiContent, toGeminiSchema, mapSchemaType, toFunctionDeclaration } from "./GeminiProvider";

describe("toGeminiContent", () => {
  it("mapea un mensaje de usuario a role 'user'", () => {
    const message: Message = { role: "user", content: "hola", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toGeminiContent(message)).toEqual({ role: "user", parts: [{ text: "hola" }] });
  });

  it("mapea un mensaje assistant sin toolCall a role 'model' con texto", () => {
    const message: Message = { role: "assistant", content: "respuesta", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(toGeminiContent(message)).toEqual({ role: "model", parts: [{ text: "respuesta" }] });
  });

  it("mapea un mensaje assistant CON toolCall a un functionCall part (no texto plano)", () => {
    const message: Message = {
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

  it("mapea un mensaje 'tool' a role 'function' con functionResponse", () => {
    const message: Message = {
      role: "tool",
      content: "Resultado: 23",
      createdAt: "2026-01-01T00:00:00.000Z",
      toolResult: { name: "read_sensor", success: true, data: { temperatureC: 23 } },
    };
    const content = toGeminiContent(message);
    expect(content.role).toBe("function");
    expect(content.parts[0]).toMatchObject({
      functionResponse: { name: "read_sensor", response: { result: { name: "read_sensor", success: true, data: { temperatureC: 23 } } } },
    });
  });
});

describe("mapSchemaType", () => {
  it("mapea 'boolean' -> BOOLEAN", () => expect(mapSchemaType("boolean")).toBe(SchemaType.BOOLEAN));
  it("mapea 'number' -> NUMBER", () => expect(mapSchemaType("number")).toBe(SchemaType.NUMBER));
  it("mapea 'integer' -> NUMBER", () => expect(mapSchemaType("integer")).toBe(SchemaType.NUMBER));
  it("mapea case-insensitive ('BOOLEAN') -> BOOLEAN", () => expect(mapSchemaType("BOOLEAN")).toBe(SchemaType.BOOLEAN));
  it("cualquier otra cosa cae a STRING por defecto", () => {
    expect(mapSchemaType("string")).toBe(SchemaType.STRING);
    expect(mapSchemaType("algo-desconocido")).toBe(SchemaType.STRING);
    expect(mapSchemaType(42)).toBe(SchemaType.STRING);
  });
});

describe("toGeminiSchema", () => {
  it("devuelve undefined para un inputSchema vacío o ausente (capability sin parámetros)", () => {
    expect(toGeminiSchema(undefined)).toBeUndefined();
    expect(toGeminiSchema({})).toBeUndefined();
  });

  it("convierte el inputSchema informal a un esquema OBJECT válido para Gemini", () => {
    const schema = toGeminiSchema({ distanceMm: "number", on: "boolean" });
    expect(schema).toEqual({
      type: SchemaType.OBJECT,
      properties: {
        distanceMm: { type: SchemaType.NUMBER },
        on: { type: SchemaType.BOOLEAN },
      },
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
    expect(declaration.parameters).toBeUndefined();
  });
});
