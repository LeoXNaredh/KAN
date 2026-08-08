import type { VoiceProviderPort } from "../../domain/ports/VoiceProviderPort";

export class SynthesizeSpeechUseCase {
  // Pick, no el puerto completo (ADR-034): el proveedor de TTS (OpenAI) no
  // implementa transcribe(), así que depender del puerto entero forzaría un
  // stub que nunca se usa.
  constructor(private readonly voiceProvider: Pick<VoiceProviderPort, "synthesize">) {}

  execute(text: string): Promise<Blob> {
    return this.voiceProvider.synthesize(text);
  }
}
