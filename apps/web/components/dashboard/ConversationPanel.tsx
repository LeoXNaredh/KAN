"use client";

import { useCallback, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Send, Wrench, X } from "lucide-react";
import type { ChatStreamEvent, Conversation } from "@kan/core";
import { Card } from "@/components/ui/Card";
import { VoiceButton } from "@/components/dashboard/VoiceButton";
import { LiveVoiceButton } from "@/components/dashboard/LiveVoiceButton";
import { ScreenShareButton } from "@/components/dashboard/ScreenShareButton";
import { useVoiceInput } from "@/lib/voice/useVoiceInput";
import { useSpeechSynthesis } from "@/lib/voice/useSpeechSynthesis";
import { useLiveSession } from "@/lib/voice/useLiveSession";
import { readSseStream } from "@/lib/chat/parseSseStream";
import { toHumanMessage } from "@/lib/errors/toHumanMessage";

type ChatRole = "user" | "assistant" | "tool";

// Mismo shape que ChatSseEvent en apps/web/app/api/chat/route.ts (ADR-027,
// docs/16 P7) — no se comparte el tipo entre server/cliente porque route.ts
// no es un módulo importable desde un componente "use client".
type ChatSseEvent = ChatStreamEvent | { type: "done"; conversation: Conversation } | { type: "done"; error: string };

function summarizeToolResultForDisplay(event: Extract<ChatStreamEvent, { type: "tool_result" }>): string {
  if (!event.success) return `Error ejecutando ${event.name}: ${event.error ?? "desconocido"}`;
  return `Resultado de ${event.name}: ${JSON.stringify(event.data)}`;
}

interface ChatImage {
  data: string;
  mimeType: string;
}

interface ChatMessage {
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
 * Lógica de chat extraída de la antigua app/page.tsx (misma llamada a
 * /api/chat, mismo estado) — ahora reutilizable: compacta dentro del
 * Dashboard, a tamaño completo en /conversacion. Desde P1, también acepta
 * voz: transcribir (ADR-014) reutiliza este mismo sendMessage() sin
 * cambios, y la respuesta final se lee en voz alta. Desde P3 (ADR-018),
 * también acepta una imagen adjunta por mensaje.
 */
export function ConversationPanel({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<ChatImage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { speak } = useSpeechSynthesis();

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
            setStreamingStatus(`Llamando a ${event.name}…`);
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

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

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
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  return (
    <Card className="fade-in flex h-full flex-col gap-3">
      <div
        className={`flex flex-1 flex-col gap-3 overflow-y-auto ${compact ? "min-h-[16rem]" : "min-h-[24rem]"}`}
      >
        {messages.length === 0 && (
          <p className="text-sm text-ink-faint">Escribe un mensaje o usa el micrófono para empezar.</p>
        )}
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
        {isSending && (
          <p className="flex items-center gap-1.5 text-sm text-ink-faint">
            {streamingStatus && <Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
            {streamingStatus ?? "KAN está pensando…"}
          </p>
        )}
      </div>

      {(error || voice.error || live.error) && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error ?? voice.error ?? live.error}
        </p>
      )}

      {live.status === "active" && (
        <p className="flex items-center gap-1.5 self-start rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          Conversación en vivo — hablá cuando quieras, sin apretar nada.
        </p>
      )}

      {pendingImage && (
        <div className="flex items-center gap-2 self-start rounded-md border border-line bg-surface-3 px-2 py-1.5">
          <img
            src={`data:${pendingImage.mimeType};base64,${pendingImage.data}`}
            alt="Imagen a adjuntar"
            className="h-10 w-10 rounded object-cover"
          />
          <span className="text-xs text-ink-muted">Imagen lista para enviar</span>
          <button
            type="button"
            aria-label="Quitar imagen"
            onClick={() => setPendingImage(null)}
            className="rounded p-1 text-ink-faint hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VoiceButton
            status={voice.status}
            onClick={voice.status === "recording" ? voice.stop : voice.start}
          />
          <LiveVoiceButton
            status={live.status}
            onClick={live.status === "active" ? live.stop : live.start}
          />
          {live.status === "active" && (
            <ScreenShareButton
              sharing={live.screenSharing}
              onClick={live.screenSharing ? live.stopScreenShare : live.startScreenShare}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleImageSelect}
          />
          <button
            type="button"
            aria-label="Adjuntar imagen"
            title="Adjuntar imagen"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-3 hover:text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ImagePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Imagen</span>
          </button>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink outline-none focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            placeholder="Escribe un mensaje..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isSending}
          />
          <button
            type="submit"
            aria-label="Enviar mensaje"
            className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:brightness-110 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            disabled={isSending || !input.trim()}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Enviar
          </button>
        </div>
      </form>
    </Card>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex items-center gap-1.5 self-start rounded-md border border-dashed border-line-strong bg-surface-3 px-3 py-1.5 font-mono text-xs text-ink-muted">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
        message.role === "user" ? "self-end bg-accent text-white" : "self-start bg-surface-3 text-ink"
      }`}
    >
      {message.toolCall && (
        <div className="mb-1 flex items-center gap-1 text-xs opacity-70">
          <Wrench className="h-3 w-3" aria-hidden="true" /> llamando a {message.toolCall.name}
        </div>
      )}
      {message.image && (
        <img
          src={`data:${message.image.mimeType};base64,${message.image.data}`}
          alt="Imagen adjunta"
          className="mb-1.5 max-h-48 rounded-md"
        />
      )}
      {message.content}
    </div>
  );
}
