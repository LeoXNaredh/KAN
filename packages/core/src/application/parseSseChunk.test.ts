import { describe, expect, it } from "vitest";
import { parseSseChunk } from "./parseSseChunk";

interface FakeEvent {
  type: string;
  content?: string;
}

describe("parseSseChunk", () => {
  it("parsea un único evento completo", () => {
    const buffer = 'data: {"type":"final","content":"hola"}\n\n';
    const { events, remainder } = parseSseChunk<FakeEvent>(buffer);

    expect(events).toEqual([{ type: "final", content: "hola" }]);
    expect(remainder).toBe("");
  });

  it("parsea varios eventos en el mismo buffer, en orden", () => {
    const buffer = 'data: {"type":"tool_call"}\n\ndata: {"type":"tool_result"}\n\ndata: {"type":"final"}\n\n';
    const { events } = parseSseChunk<FakeEvent>(buffer);

    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "final"]);
  });

  it("conserva el chunk incompleto (sin \\n\\n final) como remainder, sin parsearlo", () => {
    const buffer = 'data: {"type":"final","content":"ho';
    const { events, remainder } = parseSseChunk<FakeEvent>(buffer);

    expect(events).toEqual([]);
    expect(remainder).toBe(buffer);
  });

  it("completa un evento partido entre dos llamadas usando el remainder anterior", () => {
    const first = parseSseChunk<FakeEvent>('data: {"type":"final","con');
    const second = parseSseChunk<FakeEvent>(first.remainder + 'tent":"hola"}\n\n');

    expect(first.events).toEqual([]);
    expect(second.events).toEqual([{ type: "final", content: "hola" }]);
  });

  it("ignora un chunk con JSON malformado sin romper el resto del stream", () => {
    const buffer = "data: {esto no es json\n\n" + 'data: {"type":"final"}\n\n';
    const { events } = parseSseChunk<FakeEvent>(buffer);

    expect(events).toEqual([{ type: "final" }]);
  });

  it("ignora un chunk sin línea 'data:'", () => {
    const buffer = "event: ping\n\n" + 'data: {"type":"final"}\n\n';
    const { events } = parseSseChunk<FakeEvent>(buffer);

    expect(events).toEqual([{ type: "final" }]);
  });

  it("un buffer vacío no produce eventos ni lanza", () => {
    expect(parseSseChunk<FakeEvent>("")).toEqual({ events: [], remainder: "" });
  });
});
