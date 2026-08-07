import type { AudioInput, VoiceProviderPort } from "../../domain/ports/VoiceProviderPort";

export class TranscribeAudioUseCase {
  constructor(private readonly voiceProvider: VoiceProviderPort) {}

  execute(audio: AudioInput): Promise<string> {
    return this.voiceProvider.transcribe(audio);
  }
}
