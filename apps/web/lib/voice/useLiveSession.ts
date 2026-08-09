"use client";

import { useCallback, useRef, useState } from "react";

export type LiveSessionStatus = "idle" | "connecting" | "active" | "error";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
// Junta ~100ms de audio del worklet (que llega en bloques de 128 muestras,
// ~8ms) antes de mandarlo por el WS — evita un mensaje cada 8ms.
const SEND_CHUNK_SAMPLES = INPUT_SAMPLE_RATE / 10;

interface FunctionCall {
  id: string;
  name: string;
  args?: unknown;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PCM16 little-endian -> Float32 en [-1, 1], lo que espera AudioBuffer. */
function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

/**
 * Conversación de voz en tiempo real con Gemini Live (ADR-044) — a
 * diferencia de useVoiceInput (push-to-talk: graba, transcribe, un mensaje
 * de texto más), esto abre un WebSocket directo browser<->Gemini con audio
 * streaming bidireccional. Este servidor (apps/web) nunca ve el audio ni
 * mantiene la conexión — solo mintea la credencial de sesión
 * (/api/voice/live-session) y ejecuta las tools que el modelo pida
 * (/api/voice/live-tool), igual que el chat de texto pero disparado por el
 * browser en vez de por un loop server-side.
 */
export function useLiveSession() {
  const [status, setStatus] = useState<LiveSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sendBufferRef = useRef<Int16Array[]>([]);
  const sendBufferedSamplesRef = useRef(0);

  const stopPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Ya terminó de reproducirse — nada que hacer.
      }
    }
    activeSourcesRef.current.clear();
    if (outputContextRef.current) nextPlaybackTimeRef.current = outputContextRef.current.currentTime;
  }, []);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    void inputContextRef.current?.close();
    inputContextRef.current = null;

    stopPlayback();
    void outputContextRef.current?.close();
    outputContextRef.current = null;

    sendBufferRef.current = [];
    sendBufferedSamplesRef.current = 0;

    setStatus((current) => (current === "error" ? current : "idle"));
  }, [stopPlayback]);

  const flushSendBuffer = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || sendBufferedSamplesRef.current === 0) return;

    const merged = new Int16Array(sendBufferedSamplesRef.current);
    let offset = 0;
    for (const chunk of sendBufferRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    sendBufferRef.current = [];
    sendBufferedSamplesRef.current = 0;

    const bytes = new Uint8Array(merged.buffer);
    ws.send(
      JSON.stringify({
        realtimeInput: { audio: { data: toBase64(bytes), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` } },
      }),
    );
  }, []);

  const playAudioChunk = useCallback((base64: string) => {
    const outputContext = outputContextRef.current;
    if (!outputContext) return;

    // Copia a un Float32Array "fresco" (mismo motivo que en
    // GeminiTtsProvider.ts): copyToChannel exige un ArrayBuffer real, no el
    // ArrayBufferLike más permisivo que devuelve la vista sobre bytes crudos.
    const float32 = new Float32Array(pcm16ToFloat32(fromBase64(base64)));
    const buffer = outputContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputContext.destination);
    source.onended = () => activeSourcesRef.current.delete(source);

    const startAt = Math.max(nextPlaybackTimeRef.current, outputContext.currentTime);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + buffer.duration;
    activeSourcesRef.current.add(source);
  }, []);

  const executeToolCall = useCallback(async (call: FunctionCall) => {
    try {
      const response = await fetch("/api/voice/live-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: call.name, args: call.args ?? {} }),
      });
      const result = await response.json().catch(() => ({ success: false, error: "Respuesta inválida" }));
      return { id: call.id, name: call.name, response: result };
    } catch (err) {
      return {
        id: call.id,
        name: call.name,
        response: { success: false, error: err instanceof Error ? err.message : "Error desconocido" },
      };
    }
  }, []);

  const handleServerMessage = useCallback(
    async (raw: unknown) => {
      const message = raw as {
        serverContent?: {
          interrupted?: boolean;
          modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
        };
        toolCall?: { functionCalls?: FunctionCall[] };
      };

      if (message.serverContent?.interrupted) {
        // El usuario empezó a hablar mientras KAN sonaba — corta ya, no
        // sigue encimándose (mismo criterio que el cancel() de push-to-talk).
        stopPlayback();
      }

      const parts = message.serverContent?.modelTurn?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) playAudioChunk(part.inlineData.data);
      }

      const functionCalls = message.toolCall?.functionCalls;
      if (functionCalls?.length) {
        const functionResponses = await Promise.all(functionCalls.map(executeToolCall));
        wsRef.current?.send(JSON.stringify({ toolResponse: { functionResponses } }));
      }
    },
    [executeToolCall, playAudioChunk, stopPlayback],
  );

  const startMicCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;

    const inputContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    inputContextRef.current = inputContext;
    await inputContext.audioWorklet.addModule("/audio/pcm16-capture-worklet.js");

    const source = inputContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(inputContext, "pcm16-capture-processor");
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const chunk = new Int16Array(event.data);
      sendBufferRef.current.push(chunk);
      sendBufferedSamplesRef.current += chunk.length;
      if (sendBufferedSamplesRef.current >= SEND_CHUNK_SAMPLES) flushSendBuffer();
    };
    source.connect(worklet);
  }, [flushSendBuffer]);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "active") return;
    setError(null);
    setStatus("connecting");

    try {
      const response = await fetch("/api/voice/live-session", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo iniciar la sesión de voz.");

      outputContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      nextPlaybackTimeRef.current = 0;

      // ADR-044 (rediseño vía proxy): `data.token` es un sessionId del
      // Gateway, no un token de Gemini — el browser conecta al WS
      // /live-voice del propio Gateway, nunca a Gemini directo. El Gateway
      // ya arma y manda el mensaje `setup` con la config registrada por
      // /api/voice/live-session; el browser no manda uno propio (un
      // segundo `setup` violaría el protocolo).
      const ws = new WebSocket(`${data.wsUrl}?sessionId=${encodeURIComponent(data.token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        startMicCapture()
          .then(() => setStatus("active"))
          .catch(() => {
            setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
            setStatus("error");
            stop();
          });
      };

      ws.onmessage = async (event) => {
        const text = typeof event.data === "string" ? event.data : await (event.data as Blob).text();
        try {
          await handleServerMessage(JSON.parse(text));
        } catch {
          // Un mensaje que no pudimos parsear/manejar no debe tirar abajo la sesión.
        }
      };

      ws.onerror = () => {
        setError("Error de conexión con la sesión de voz.");
        setStatus("error");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) stop();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido al iniciar la sesión de voz.");
      setStatus("error");
      stop();
    }
  }, [handleServerMessage, startMicCapture, status, stop]);

  return { status, error, start, stop };
}
