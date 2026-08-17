import { describe, expect, it } from "vitest";
import type { Conversation } from "@kan/core";
import { SupabaseConversationRepository } from "./SupabaseConversationRepository";
import { createFakeFromClient, type RecordedCall } from "./testFakes";

function hasCall(calls: RecordedCall[], method: string): boolean {
  return calls.some((call) => call.method === method);
}

describe("SupabaseConversationRepository", () => {
  it("getById devuelve undefined si la conversación no existe (o no es del usuario)", async () => {
    const client = createFakeFromClient({
      conversations: { data: null, error: null },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    expect(await repo.getById("no-existe")).toBeUndefined();
  });

  it("getById reconstruye la conversación con sus mensajes en orden", async () => {
    const client = createFakeFromClient({
      conversations: {
        data: { id: "c1", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:05:00.000Z" },
        error: null,
      },
      messages: {
        data: [
          { id: "m1", role: "user", content: "hola", tool_call: null, tool_result: null, created_at: "2026-01-01T00:01:00.000Z" },
          {
            id: "m2",
            role: "assistant",
            content: "hola de vuelta",
            tool_call: null,
            tool_result: null,
            created_at: "2026-01-01T00:02:00.000Z",
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    const conversation = await repo.getById("c1");
    expect(conversation).toEqual({
      id: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      messages: [
        { id: "m1", role: "user", content: "hola", createdAt: "2026-01-01T00:01:00.000Z", toolCall: undefined, toolResult: undefined },
        {
          id: "m2",
          role: "assistant",
          content: "hola de vuelta",
          createdAt: "2026-01-01T00:02:00.000Z",
          toolCall: undefined,
          toolResult: undefined,
        },
      ],
    });
  });

  it("getById reconstruye un mensaje con imagen (P3, ADR-018)", async () => {
    const client = createFakeFromClient({
      conversations: {
        data: { id: "c1", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:05:00.000Z" },
        error: null,
      },
      messages: {
        data: [
          {
            id: "m1",
            role: "user",
            content: "¿qué es esto?",
            tool_call: null,
            tool_result: null,
            created_at: "2026-01-01T00:01:00.000Z",
            image_data: "ZmFrZQ==",
            image_mime_type: "image/png",
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    const conversation = await repo.getById("c1");
    expect(conversation?.messages[0].image).toEqual({ data: "ZmFrZQ==", mimeType: "image/png" });
  });

  it("save() persiste image_data/image_mime_type de un mensaje con imagen", async () => {
    let insertedPayload: unknown;
    const client = createFakeFromClient({
      conversations: { data: null, error: null },
      messages: (calls: RecordedCall[]) => {
        if (hasCall(calls, "insert")) {
          insertedPayload = calls.find((call) => call.method === "insert")?.args[0];
          return { data: null, error: null };
        }
        return { data: [], error: null };
      },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    await repo.save({
      id: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "¿qué es esto?",
          createdAt: "2026-01-01T00:01:00.000Z",
          image: { data: "ZmFrZQ==", mimeType: "image/png" },
        },
      ],
    });

    expect((insertedPayload as Array<{ image_data: string; image_mime_type: string }>)[0]).toMatchObject({
      image_data: "ZmFrZQ==",
      image_mime_type: "image/png",
    });
  });

  it("save() inserta solo los mensajes que todavía no existen, nunca reescribe uno persistido", async () => {
    let insertedPayload: unknown;
    const client = createFakeFromClient({
      conversations: { data: null, error: null },
      messages: (calls: RecordedCall[]) => {
        if (hasCall(calls, "insert")) {
          insertedPayload = calls.find((call) => call.method === "insert")?.args[0];
          return { data: null, error: null };
        }
        // La comprobación de ids existentes: "m1" ya está persistido, "m2" no.
        return { data: [{ id: "m1" }], error: null };
      },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    const conversation: Conversation = {
      id: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      messages: [
        { id: "m1", role: "user", content: "hola", createdAt: "2026-01-01T00:01:00.000Z" },
        { id: "m2", role: "assistant", content: "hola de vuelta", createdAt: "2026-01-01T00:02:00.000Z" },
      ],
    };

    await repo.save(conversation);

    expect(insertedPayload).toHaveLength(1);
    expect((insertedPayload as Array<{ id: string }>)[0].id).toBe("m2");
  });

  it("save() no inserta nada si todos los mensajes ya existen", async () => {
    let insertCalled = false;
    const client = createFakeFromClient({
      conversations: { data: null, error: null },
      messages: (calls: RecordedCall[]) => {
        if (hasCall(calls, "insert")) {
          insertCalled = true;
          return { data: null, error: null };
        }
        return { data: [{ id: "m1" }], error: null };
      },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    await repo.save({
      id: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      messages: [{ id: "m1", role: "user", content: "hola", createdAt: "2026-01-01T00:01:00.000Z" }],
    });

    expect(insertCalled).toBe(false);
  });

  it("save() lanza si el upsert de la conversación falla", async () => {
    const client = createFakeFromClient({
      conversations: { data: null, error: { message: "fila inválida" } },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    await expect(
      repo.save({ id: "c1", createdAt: "x", updatedAt: "x", messages: [] }),
    ).rejects.toThrow("fila inválida");
  });

  it("listRecent() devuelve [] sin consultar mensajes si el usuario no tiene conversaciones", async () => {
    const client = createFakeFromClient({
      conversations: { data: [], error: null },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    expect(await repo.listRecent(5)).toEqual([]);
  });

  it("listRecent() deriva el título de la primera línea del primer mensaje user de cada conversación", async () => {
    const client = createFakeFromClient({
      conversations: {
        data: [
          { id: "c1", updated_at: "2026-01-02T00:00:00.000Z" },
          { id: "c2", updated_at: "2026-01-01T00:00:00.000Z" },
        ],
        error: null,
      },
      messages: {
        data: [
          { conversation_id: "c1", content: "¿cómo prendo la impresora?\nsegunda línea", created_at: "2026-01-01T00:01:00.000Z" },
          { conversation_id: "c2", content: "hola", created_at: "2026-01-01T00:00:30.000Z" },
        ],
        error: null,
      },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    expect(await repo.listRecent(5)).toEqual([
      { id: "c1", title: "¿cómo prendo la impresora?", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "c2", title: "hola", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("listRecent() usa el título por defecto si una conversación no tiene mensajes user todavía", async () => {
    const client = createFakeFromClient({
      conversations: { data: [{ id: "c1", updated_at: "2026-01-01T00:00:00.000Z" }], error: null },
      messages: { data: [], error: null },
    });
    const repo = new SupabaseConversationRepository(client, "u1");

    expect(await repo.listRecent(5)).toEqual([{ id: "c1", title: "Conversación sin título", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  });
});
