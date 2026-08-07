import { useCallback, useState } from "react";
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from "expo-audio";
import { uploadAudio } from "./uploadAudio";

export type VoiceInputStatus = "idle" | "recording" | "transcribing";

/**
 * Push-to-talk (docs/18, incremento 4) — mismo contrato que
 * `apps/web/lib/voice/useVoiceInput.ts`: graba, sube el audio al detener, y
 * entrega el texto transcrito vía `onTranscribed` — quien use el hook
 * decide qué hacer (en la pantalla de chat, se envía directo como si el
 * usuario lo hubiera tipeado, igual que en web — nunca se muestra para
 * editar antes de enviar).
 */
export function useVoiceInput(onTranscribed: (text: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setError("No se pudo acceder al micrófono. Revisa los permisos de la app.");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus("recording");
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos de la app.");
      setStatus("idle");
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    setStatus("transcribing");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No se generó ningún archivo de audio.");
      const text = await uploadAudio(uri);
      const trimmed = text.trim();
      if (trimmed) onTranscribed(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setStatus("idle");
    }
  }, [recorder, onTranscribed]);

  return { status, error, start, stop };
}
