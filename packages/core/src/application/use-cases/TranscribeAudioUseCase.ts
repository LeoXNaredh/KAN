import type { AudioInput, VoiceProviderPort } from "../../domain/ports/VoiceProviderPort";

export class TranscribeAudioUseCase {
  // Pick, no el puerto completo (ADR-034): el proveedor de STT (Groq) no
  // implementa synthesize(), así que depender del puerto entero rompería
  // esta composición apenas VoiceProviderPort ganó ese método.
  constructor(private readonly voiceProvider: Pick<VoiceProviderPort, "transcribe">) {}

  execute(audio: AudioInput): Promise<string> {
    return this.voiceProvider.transcribe(audio);
  }
}
