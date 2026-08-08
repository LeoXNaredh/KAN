/**
 * STT + TTS (ADR-014, ADR-034, docs/00). `transcribe()` y `synthesize()`
 * casi nunca los implementa el mismo proveedor de red (hoy: Groq para STT,
 * OpenAI para TTS) — quien consuma este puerto debería depender solo del
 * método que necesita vía `Pick<VoiceProviderPort, "transcribe" | "synthesize">`,
 * no del puerto completo (ver TranscribeAudioUseCase/SynthesizeSpeechUseCase).
 */
export interface AudioInput {
  /** El `File`/`Blob` tal cual llega de `request.formData()` en el route handler. */
  data: Blob;
  /** Ej. "audio/webm" — el proveedor lo necesita para el content-type real. */
  mimeType: string;
}

export interface VoiceProviderPort {
  transcribe(audio: AudioInput): Promise<string>;
  /** Devuelve el audio sintetizado listo para reproducir (ej. `audio/mpeg`). */
  synthesize(text: string): Promise<Blob>;
}
