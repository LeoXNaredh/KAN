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

// Visión Fase 1 (P3, ADR-018): límite aplicado en el borde, no en el
// dominio — 4 MB decodificados, calculado sobre la longitud del base64.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type ImageParseResult =
  | { ok: true; image?: { data: string; mimeType: string } }
  | { ok: false; error: string };

function parseImage(body: unknown): ImageParseResult {
  const image = (body as { image?: unknown } | null)?.image;
  if (image === undefined || image === null) return { ok: true, image: undefined };

  const data = (image as { data?: unknown }).data;
  const mimeType = (image as { mimeType?: unknown }).mimeType;
  if (typeof data !== "string" || typeof mimeType !== "string") {
    return { ok: false, error: "'image' debe tener 'data' (base64) y 'mimeType' como strings." };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: `Tipo de imagen no soportado: ${mimeType}. Usa PNG, JPEG, WEBP o GIF.` };
  }
  if (data.length > MAX_IMAGE_BASE64_LENGTH) {
    return { ok: false, error: "La imagen supera el límite de 4 MB." };
  }
  return { ok: true, image: { data, mimeType } };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const userMessage = typeof body?.message === "string" ? body.message.trim() : "";

  if (!userMessage) {
    return NextResponse.json({ error: "El campo 'message' es requerido." }, { status: 400 });
  }

  const imageResult = parseImage(body);
  if (!imageResult.ok) {
    return NextResponse.json({ error: imageResult.error }, { status: 400 });
  }

  try {
    const useCase = await buildUseCase();
    const { conversation } = await useCase.execute({
      conversationId: typeof body?.conversationId === "string" ? body.conversationId : undefined,
      userMessage,
      image: imageResult.image,
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
