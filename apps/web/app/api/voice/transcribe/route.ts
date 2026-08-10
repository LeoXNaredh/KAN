import { NextResponse } from "next/server";
import { buildTranscribeAudioUseCase, MissingGroqConfigError } from "@/lib/voice/composition";
import { requireUser } from "@/lib/auth/requireUser";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("audio");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Falta el archivo de audio ('audio')." }, { status: 400 });
  }

  try {
    const useCase = buildTranscribeAudioUseCase();
    const text = await useCase.execute({ data: file, mimeType: file.type || "audio/webm" });
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof MissingGroqConfigError) {
      return NextResponse.json({ error: error.message }, { status: 412 });
    }
    console.error("[/api/voice/transcribe] error inesperado:", error);
    return NextResponse.json(
      { error: "Error inesperado al transcribir el audio. Revisa los logs del servidor." },
      { status: 502 },
    );
  }
}
