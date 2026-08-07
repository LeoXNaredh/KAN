import { GeminiProvider, ModelRouter } from "@kan/ai-abstraction";
import type { SendMessageUseCase } from "@kan/core";
import { NextResponse } from "next/server";
import { GatewayToolProvider } from "@/lib/gateway/GatewayToolProvider";
import { buildSendMessageUseCase } from "@/lib/chat/composition";

/**
 * Composition root: único lugar donde se instancian implementaciones concretas
 * (ver docs/01-arquitectura-general.md, capas Clean Architecture). El resto de
 * la app solo conoce los puertos definidos en @kan/core. La persistencia real
 * (Supabase, si hay sesión, o el fallback en memoria si no) se resuelve en
 * lib/chat/composition.ts (ADR-017, P0.2).
 */
const toolProvider = new GatewayToolProvider({
  baseUrl: process.env.KAN_GATEWAY_URL ?? "http://localhost:8787",
  internalToken: process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token",
});

async function buildUseCase(): Promise<SendMessageUseCase> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  const model = process.env.GEMINI_MODEL || undefined;
  const aiProvider = new ModelRouter(new GeminiProvider({ apiKey, model }));
  return buildSendMessageUseCase(aiProvider, toolProvider);
}

class MissingApiKeyError extends Error {
  constructor() {
    super(
      "Falta GEMINI_API_KEY. Copia apps/web/.env.example a apps/web/.env.local y agrega tu API key gratuita de Gemini (https://aistudio.google.com/apikey).",
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const userMessage = typeof body?.message === "string" ? body.message.trim() : "";

  if (!userMessage) {
    return NextResponse.json({ error: "El campo 'message' es requerido." }, { status: 400 });
  }

  try {
    const useCase = await buildUseCase();
    const { conversation } = await useCase.execute({
      conversationId: typeof body?.conversationId === "string" ? body.conversationId : undefined,
      userMessage,
    });
    return NextResponse.json({ conversation });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      return NextResponse.json({ error: error.message }, { status: 412 });
    }
    console.error("[/api/chat] error inesperado:", error);
    return NextResponse.json(
      { error: "Error inesperado al hablar con el proveedor de IA. Revisa los logs del servidor." },
      { status: 502 },
    );
  }
}
