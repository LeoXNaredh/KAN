"use client";

import { useCallback, useState } from "react";
import { translateToolCall, translateToolResult, type ChatStreamEvent, type Conversation } from "@kan/core";
import { useVoiceInput } from "@/lib/voice/useVoiceInput";
import { useSpeechSynthesis } from "@/lib/voice/useSpeechSynthesis";
import { useLiveSession } from "@/lib/voice/useLiveSession";
import { readSseStream } from "@/lib/chat/parseSseStream";
import { toHumanMessage } from "@/lib/errors/toHumanMessage";

export type ChatRole = "user" | "assistant" | "tool";

// Mismo shape que ChatSseEvent en apps/web/app/api/chat/route.ts (ADR-027,
// docs/16 P7) — no se comparte el tipo entre server/cliente porque route.ts
// no es un módulo importable desde un componente "use client".
type ChatSseEvent = ChatStreamEvent | { type: "done"; conversation: Conversation } | { type: "done"; error: string };

function summarizeToolResultForDisplay(event: Extract<ChatStreamEvent, { type: "tool_result" }>): string {
  return translateToolResult(event.name, event.success, event.error);
}

export interface ChatImage {
  data: string;
  mimeType: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCall?: { name: string; args: unknown };
  image?: ChatImage;
}

// Mismo límite que /api/chat (ADR-018) — se valida acá también para dar
// feedback inmediato en vez de esperar el viaje de ida y vuelta al servidor.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

/**
 * Estado y lógica de una conversación con KAN — extraído de
 * `ConversationPanel` (rediseño de identidad KAN) para que `KANHome`
 * (layout de 3 estados) pueda compartir exactamente la misma lógica de
 * chat/voz/streaming sin duplicarla ni divergir. `ConversationPanel` sigue
 * siendo la presentación "clásica" (burbujas en `/conversacion` y el modo
 * compacto del Dashboard); este hook no cambia ningún comportamiento
 * respecto de antes de la extracción.
 */
export function useConversation() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<ChatImage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { speak, isSpeaking } = useSpeechSynthesis();

  const sendMessage = useCallback(
    async (userMessage: string, options?: { viaVoice?: boolean }) => {
      if (!userMessage.trim() || isSending) return;
      const trimmed = userMessage.trim();
      const image = pendingImage ?? undefined;
      const preSubmitCount = messages.length;
      setMessages((prev) => [...prev, { role: "user", content: trimmed, image }]);
      setInput("");
      setPendingImage(null);
      setIsSending(true);
      setStreamingStatus(null);
      setError(null);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, conversationId, image }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Error desconocido");
        }

        // Streaming (ADR-027, docs/16 P7): tool_call/tool_result llegan en
        // vivo mientras el loop corre; "done" trae la conversación
        // persistida completa, que reemplaza cualquier burbuja provisional
        // agregada durante el streaming — nunca queda divergiendo de lo real.
        let finalConversation: Conversation | undefined;
        let streamError: string | undefined;

        for await (const event of readSseStream<ChatSseEvent>(response)) {
          if (event.type === "tool_call") {
            setStreamingStatus(translateToolCall(event.name));
          } else if (event.type === "tool_result") {
            setStreamingStatus(null);
            setMessages((prev) => [...prev, { role: "tool", content: summarizeToolResultForDisplay(event) }]);
          } else if (event.type === "final") {
            setStreamingStatus(null);
          } else if (event.type === "done") {
            if ("error" in event) streamError = event.error;
            else finalConversation = event.conversation;
          }
        }

        if (streamError) throw new Error(streamError);
        if (!finalConversation) throw new Error("El servidor cerró la conexión sin una respuesta final.");

        setConversationId(finalConversation.id);

        const newMessages: ChatMessage[] = finalConversation.messages
          .slice(preSubmitCount + 1)
          .map((m) => ({ role: m.role as ChatRole, content: m.content, toolCall: m.toolCall, image: m.image }));
        // Descarta las burbujas provisionales de tool_result y deja solo lo
        // realmente persistido — mismo criterio de "el server es la fuente
        // de verdad" que ya usaba la versión no-streaming.
        setMessages((prev) => [...prev.slice(0, preSubmitCount + 1), ...newMessages]);

        // Habla la respuesta solo si el turno del usuario vino por voz
        // (ADR-034) — evita costo real de TTS de red en cada mensaje tipeado.
        const lastAssistantMessage = [...newMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistantMessage?.content && options?.viaVoice) speak(lastAssistantMessage.content);
      } catch (err) {
        setError(toHumanMessage(err instanceof Error ? err.message : undefined));
      } finally {
        setIsSending(false);
        setStreamingStatus(null);
      }
    },
    [conversationId, isSending, messages.length, pendingImage, speak],
  );

  const voice = useVoiceInput((text) => sendMessage(text, { viaVoice: true }));
  const live = useLiveSession();

  const selectImage = useCallback(async (file: File) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      setError("Formato de imagen no soportado. Usa PNG, JPEG, WEBP o GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("La imagen supera el límite de 4 MB.");
      return;
    }

    setError(null);
    const data = await fileToBase64(file);
    setPendingImage({ data, mimeType: file.type });
  }, []);

  return {
    messages,
    input,
    setInput,
    pendingImage,
    setPendingImage,
    isSending,
    streamingStatus,
    error,
    isSpeaking,
    voice,
    live,
    sendMessage,
    selectImage,
  };
}
