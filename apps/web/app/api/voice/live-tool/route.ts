import { NextResponse } from "next/server";
import { buildLiveToolDispatcher } from "@/lib/voice/liveComposition";
import { resolveUserToken } from "@/lib/auth/resolveUserToken";

/**
 * Relay de ejecución de tools para una sesión de voz en tiempo real
 * (ADR-044): el browser está conectado directo a Gemini, así que un
 * `toolCall` lo recibe el browser, no este servidor — pero la ejecución
 * real (Gateway/Edge Agent, memoria) sigue pasando por acá, nunca por una
 * credencial que el browser tenga en la mano.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name) {
    return NextResponse.json({ success: false, error: "Falta el nombre de la tool ('name')." }, { status: 400 });
  }

  try {
    const executeLiveTool = await buildLiveToolDispatcher(await resolveUserToken(request));
    const result = await executeLiveTool(name, body?.args ?? {});
    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/voice/live-tool] error inesperado:", error);
    return NextResponse.json(
      { success: false, error: "Error inesperado al ejecutar la herramienta. Revisa los logs del servidor." },
      { status: 502 },
    );
  }
}
