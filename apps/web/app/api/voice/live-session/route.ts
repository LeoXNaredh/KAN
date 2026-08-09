import { NextResponse } from "next/server";
import { buildCreateLiveSessionUseCase } from "@/lib/voice/liveComposition";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * Registra una sesión de voz en tiempo real en el Gateway (ADR-044,
 * rediseño vía proxy) — responde rápido con `{model, wsUrl, token,
 * expiresAt}` (acá `token` es el `sessionId` del Gateway, no un token de
 * Gemini), nunca mantiene el WebSocket: el browser lo abre contra el
 * `/live-voice` del Gateway, que proxea hacia Gemini con la key real.
 */
export async function POST(request: Request) {
  try {
    const useCase = await buildCreateLiveSessionUseCase(await resolveUserToken(request));
    const session = await useCase.execute();
    return NextResponse.json(session);
  } catch (error) {
    console.error("[/api/voice/live-session] error inesperado:", error);
    const message = error instanceof Error ? error.message : "Error inesperado al iniciar la sesión de voz.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
