import { NextResponse } from "next/server";
import { buildSynthesizeSpeechUseCase, MissingOpenAiConfigError } from "@/lib/voice/composition";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Falta el texto a sintetizar ('text')." }, { status: 400 });
  }

  try {
    const useCase = buildSynthesizeSpeechUseCase();
    const audio = await useCase.execute(text);
    return new NextResponse(audio, { status: 200, headers: { "Content-Type": audio.type || "audio/mpeg" } });
  } catch (error) {
    if (error instanceof MissingOpenAiConfigError) {
      return NextResponse.json({ error: error.message }, { status: 412 });
    }
    console.error("[/api/voice/synthesize] error inesperado:", error);
    return NextResponse.json(
      { error: "Error inesperado al sintetizar el audio. Revisa los logs del servidor." },
      { status: 502 },
    );
  }
}
