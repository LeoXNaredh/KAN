import { GeminiProvider, AnthropicProvider, OpenAiProvider, ModelRouter } from "@kan/ai-abstraction";
import type { AIProviderPort, ChatStreamEvent, Conversation, SendMessageUseCase } from "@kan/core";
import { NextResponse } from "next/server";
import { GatewayToolProvider } from "@/lib/gateway/GatewayToolProvider";
import { buildSendMessageUseCase } from "@/lib/chat/composition";
import { extractBearerToken } from "@/lib/auth/extractBearerToken";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * Composition root: único lugar donde se instancian implementaciones concretas
 * (ver docs/01-arquitectura-general.md, capas Clean Architecture). El resto de
 * la app solo conoce los puertos definidos en @kan/core. La persistencia real
 * (Supabase, si hay sesión, o el fallback en memoria si no) se resuelve en
 * lib/chat/composition.ts (ADR-017, P0.2).
 */
// `toolProvider` se construye por request (no a nivel de módulo) porque
// necesita el `X-User-Token` de esa request específica (P2 incremento 2,
// docs/19) — a diferencia del token interno, que sí es fijo.
async function buildUseCase(accessToken: string | undefined, gatewayUserToken: string | undefined): Promise<SendMessageUseCase> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  const model = process.env.GEMINI_MODEL || undefined;
  const primary = new GeminiProvider({ apiKey, model });
  // Fallback real (ADR-054): si Gemini falla (rate limit, caída del
  // servicio), ModelRouter prueba el siguiente proveedor configurado antes
  // de rendirse — cierra el riesgo ya documentado en docs/11-riesgos.md
  // ("Rate limits de Gemini free-tier bloquean uso real con varios
  // usuarios"). Cada uno es opcional: sin su API key, simplemente no se
  // agrega a la lista, el chat sigue funcionando solo con Gemini igual que
  // antes de este incremento.
  const fallbacks: AIProviderPort[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    fallbacks.push(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }));
  }
  if (process.env.OPENAI_API_KEY) {
    fallbacks.push(new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY }));
  }
  const aiProvider = new ModelRouter(primary, fallbacks);
  const toolProvider = new GatewayToolProvider({
    baseUrl: process.env.KAN_GATEWAY_URL ?? "http://localhost:8787",
    internalToken: process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token",
    userToken: gatewayUserToken,
  });
  return buildSendMessageUseCase(aiProvider, toolProvider, accessToken);
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

/**
 * Eventos que viajan por el stream SSE (ADR-027, docs/16 P7): los
 * `ChatStreamEvent` que ya emite `SendMessageUseCase` (tool_call/tool_result/
 * final) más un evento de cierre `done` — la conversación persistida
 * completa, o un error si algo falló dentro de `execute()`. El status HTTP
 * ya no puede cambiar una vez que el stream arrancó (siempre 200), así que
 * un error dentro del loop viaja como dato del stream, no como código de
 * estado — a diferencia de los errores de validación/configuración de abajo,
 * que ocurren *antes* de abrir el stream y sí devuelven un status normal.
 */
type ChatSseEvent = ChatStreamEvent | { type: "done"; conversation: Conversation } | { type: "done"; error: string };

function sseChunk(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
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

  let useCase: SendMessageUseCase;
  try {
    useCase = await buildUseCase(extractBearerToken(request), await resolveUserToken(request));
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      return NextResponse.json({ error: error.message }, { status: 412 });
    }
    console.error("[/api/chat] error inesperado construyendo el caso de uso:", error);
    return NextResponse.json(
      { error: "Error inesperado al hablar con el proveedor de IA. Revisa los logs del servidor." },
      { status: 502 },
    );
  }

  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatSseEvent) => controller.enqueue(encoder.encode(sseChunk(event)));
      try {
        const { conversation } = await useCase.execute(
          { conversationId, userMessage, image: imageResult.image },
          send,
        );
        send({ type: "done", conversation });
      } catch (error) {
        console.error("[/api/chat] error inesperado durante el streaming:", error);
        send({ type: "done", error: "Error inesperado al hablar con el proveedor de IA. Revisa los logs del servidor." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
