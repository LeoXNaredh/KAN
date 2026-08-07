/**
 * Solo STT por ahora (ADR-014, docs/00) — la síntesis de voz de Fase 1 usa
 * la SpeechSynthesis nativa del navegador, no un proveedor de red, así que
 * no vive detrás de este puerto todavía.
 */
export interface AudioInput {
  /** El `File`/`Blob` tal cual llega de `request.formData()` en el route handler. */
  data: Blob;
  /** Ej. "audio/webm" — el proveedor lo necesita para el content-type real. */
  mimeType: string;
}

export interface VoiceProviderPort {
  transcribe(audio: AudioInput): Promise<string>;
}
