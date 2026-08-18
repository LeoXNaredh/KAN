"use client";

import { useCallback, useRef, useState } from "react";

export type LiveSessionStatus = "idle" | "connecting" | "active" | "error";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
// Junta ~100ms de audio del worklet (que llega en bloques de 128 muestras,
// ~8ms) antes de mandarlo por el WS — evita un mensaje cada 8ms.
const SEND_CHUNK_SAMPLES = INPUT_SAMPLE_RATE / 10;

// Visión de pantalla en tiempo real (ADR-044 fase 2) — un frame de imagen
// más en el mismo WS, no un canal nuevo. 1 frame/seg alcanza para leer
// texto/IDs en pantalla sin inflar el payload; achicar a 1280px + JPEG
// calidad 0.6 mantiene cada frame bien por debajo del límite de 1MB del
// proxy del Gateway (GeminiLiveProxy, MAX_PAYLOAD_BYTES).
const SCREEN_SHARE_INTERVAL_MS = 1000;
const SCREEN_SHARE_MAX_WIDTH = 1280;
const SCREEN_SHARE_JPEG_QUALITY = 0.6;

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
  const [screenSharing, setScreenSharing] = useState(false);
  const [cameraSharing, setCameraSharing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sendBufferRef = useRef<Int16Array[]>([]);
  const sendBufferedSamplesRef = useRef(0);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<number | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraIntervalRef = useRef<number | null>(null);

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

  const stopScreenShare = useCallback(() => {
    if (screenIntervalRef.current !== null) {
      window.clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
  }, []);

  const stopCameraShare = useCallback(() => {
    if (cameraIntervalRef.current !== null) {
      window.clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraSharing(false);
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

    stopScreenShare();
    stopCameraShare();

    setStatus((current) => (current === "error" ? current : "idle"));
  }, [stopPlayback, stopScreenShare, stopCameraShare]);

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

  /**
   * Mecánica compartida entre pantalla compartida y cámara (ADR-044 fase 2
   * para pantalla; ADR-059 agrega cámara con el mismo pipeline) — la única
   * diferencia real entre las dos es de dónde sale el `MediaStream`
   * (`getDisplayMedia` vs `getUserMedia`). Un frame JPEG por segundo,
   * mandado como un turn de clientContent con turnComplete:false (ver
   * comentario más abajo sobre por qué no es realtimeInput.video) — Gemini
   * los usa para leer texto/IDs/IPs, identificar hardware físico (cámara) o
   * en pantalla, y guiar por voz, nunca para controlar el mouse/teclado del
   * usuario (eso no está implementado).
   */
  const startVideoShare = useCallback(
    async (
      getStream: () => Promise<MediaStream>,
      streamRef: { current: MediaStream | null },
      intervalRef: { current: number | null },
      setSharing: (value: boolean) => void,
      alreadySharing: boolean,
      stopThis: () => void,
    ) => {
      if (alreadySharing) return;

      const stream = await getStream();
      streamRef.current = stream;

      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const sourceWidth = settings?.width ?? video.videoWidth;
      const sourceHeight = settings?.height ?? video.videoHeight;
      const scale = Math.min(1, SCREEN_SHARE_MAX_WIDTH / sourceWidth);

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const ctx = canvas.getContext("2d");

      // Si el usuario corta el compartir desde el picker nativo del
      // navegador (no desde nuestro botón), no debe quedar un estado
      // "compartiendo" fantasma sin stream real detrás.
      track?.addEventListener("ended", stopThis);

      intervalRef.current = window.setInterval(() => {
        const ws = wsRef.current;
        if (!ctx || !ws || ws.readyState !== WebSocket.OPEN) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return;
            blob.arrayBuffer().then((buffer) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const base64 = toBase64(new Uint8Array(buffer));
              // Verificado en vivo (ADR-044 fase 2): `realtimeInput.video` no
              // funciona con esta cuenta/modelo — Gemini responde "no puedo
              // ver imágenes" y lo ignora en silencio. El campo real es un
              // turn de `clientContent` con la imagen como `inlineData`, con
              // `turnComplete: false` para que solo sume contexto sin
              // disparar una respuesta — el turno lo completa la voz, no la
              // imagen.
              ws.send(
                JSON.stringify({
                  clientContent: {
                    turns: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64 } }] }],
                    turnComplete: false,
                  },
                }),
              );
            });
          },
          "image/jpeg",
          SCREEN_SHARE_JPEG_QUALITY,
        );
      }, SCREEN_SHARE_INTERVAL_MS);

      setSharing(true);
    },
    [],
  );

  const startScreenShare = useCallback(
    () =>
      startVideoShare(
        () => navigator.mediaDevices.getDisplayMedia({ video: true }),
        screenStreamRef,
        screenIntervalRef,
        setScreenSharing,
        screenSharing,
        stopScreenShare,
      ),
    [startVideoShare, screenSharing, stopScreenShare],
  );

  /**
   * Cámara (ADR-059) — el pedido original asumía que ya estaba implementada
   * junto con pantalla compartida; ADR-044 la había dejado afuera a
   * propósito ("mismo mecanismo serviría después, no pedido ahora"). Con el
   * pipeline ya generalizado en startVideoShare(), agregarla es mecánico:
   * mismo flujo, `getUserMedia({video:true})` en vez de `getDisplayMedia()`.
   */
  const startCameraShare = useCallback(
    () =>
      startVideoShare(
        () => navigator.mediaDevices.getUserMedia({ video: true }),
        cameraStreamRef,
        cameraIntervalRef,
        setCameraSharing,
        cameraSharing,
        stopCameraShare,
      ),
    [startVideoShare, cameraSharing, stopCameraShare],
  );

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
          .then(() => {
            setStatus("active");
            // ADR-059: apenas conecta, le pedimos al modelo que revise qué
            // dispositivos/capabilities tiene disponibles y lo resuma por
            // voz — un turno real (turnComplete:true, a diferencia de los
            // frames de video que solo suman contexto), porque acá
            // necesitamos que efectivamente responda. El cliente no elige
            // qué discover_io_map llamar: el modelo ya tiene cada
            // capability de cada dispositivo conectado como tool nombrada.
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [
                        {
                          text:
                            "Recién te conectaste. Revisá qué dispositivos y capabilities tenés disponibles ahora " +
                            "mismo y contame en una frase breve qué encontraste.",
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                },
              }),
            );
          })
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

  return {
    status,
    error,
    start,
    stop,
    screenSharing,
    startScreenShare,
    stopScreenShare,
    cameraSharing,
    startCameraShare,
    stopCameraShare,
  };
}
