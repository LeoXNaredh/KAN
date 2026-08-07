"use client";

import { useCallback, useRef, useState } from "react";

export type VoiceInputStatus = "idle" | "recording" | "transcribing";

/**
 * Push-to-talk (ADR-014, docs/00): graba con MediaRecorder, sube el blob a
 * /api/voice/transcribe al detener, y entrega el texto transcrito — quien
 * use el hook decide qué hacer con él (en ConversationPanel, se envía como
 * si el usuario lo hubiera tipeado).
 */
export function useVoiceInput(onTranscribed: (text: string) => void) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const preferredType = "audio/webm";
      const mimeType = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(preferredType)
        ? preferredType
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        setStatus("transcribing");

        try {
          const formData = new FormData();
          formData.append("audio", blob, "audio.webm");
          const response = await fetch("/api/voice/transcribe", { method: "POST", body: formData });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Error desconocido al transcribir");
          const text = typeof data.text === "string" ? data.text.trim() : "";
          if (text) onTranscribed(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error desconocido");
        } finally {
          setStatus("idle");
        }
      };

      recorder.start();
      setStatus("recording");
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
      setStatus("idle");
    }
  }, [onTranscribed]);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  return { status, error, start, stop };
}
