"use client";

import { useRef, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Send, Volume2, Wrench, X } from "lucide-react";
import { translateToolCall } from "@kan/core";
import { Card } from "@/components/ui/Card";
import { VoiceButton } from "@/components/dashboard/VoiceButton";
import { LiveVoiceButton } from "@/components/dashboard/LiveVoiceButton";
import { ScreenShareButton } from "@/components/dashboard/ScreenShareButton";
import { CameraShareButton } from "@/components/dashboard/CameraShareButton";
import { PendingConfirmationModal } from "@/components/dashboard/PendingConfirmationModal";
import { useConversation, type ChatMessage } from "@/lib/chat/useConversation";

/**
 * Presentación "clásica" de la conversación (burbujas + input) — usada en
 * `/conversacion` (a pantalla completa) y compacta dentro del Dashboard
 * previo al rediseño de identidad. La lógica de chat/voz/streaming vive en
 * `useConversation` (compartida con `KANHome`, el nuevo layout de 3
 * estados) — este componente es puramente presentación sobre ese hook.
 */
export function ConversationPanel({
  compact = false,
  framed = true,
  initialConversationId,
}: {
  compact?: boolean;
  framed?: boolean;
  /** Chat guardado a reabrir (sidebar) — ver useConversation(). */
  initialConversationId?: string;
}) {
  const {
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
    pendingConfirmation,
    resolveConfirmation,
  } = useConversation(initialConversationId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await selectImage(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  const Wrapper = framed ? Card : "div";
  const wrapperClassName = framed
    ? "fade-in flex h-full flex-col gap-3"
    : "fade-in flex h-full flex-col gap-4";

  return (
    <>
      {pendingConfirmation && (
        <PendingConfirmationModal
          confirmation={pendingConfirmation}
          busy={isSending}
          onCancel={() => resolveConfirmation(false)}
          onConfirm={() => resolveConfirmation(true)}
        />
      )}
      <Wrapper className={wrapperClassName}>
      <div
        className={`kan-scroll flex flex-1 flex-col gap-4 overflow-y-auto ${compact ? "min-h-[16rem]" : "min-h-[24rem]"}`}
      >
        {messages.length === 0 && (
          <p className="text-sm text-ink-faint">Escribí un mensaje o tocá el micrófono para empezar.</p>
        )}
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
        {isSending && (
          <p className="flex items-center gap-1.5 text-sm text-ink-faint">
            <span className="flex gap-0.5" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
            </span>
            {streamingStatus ?? "KAN está pensando"}
          </p>
        )}
        {!isSending && isSpeaking && (
          <p className="flex items-center gap-1.5 text-sm text-accent">
            <Volume2 className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            KAN está hablando
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
            className="press rounded p-1 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <LiveVoiceButton status={live.status} onClick={live.status === "active" ? live.stop : live.start} />
          {live.status === "active" && (
            <ScreenShareButton
              sharing={live.screenSharing}
              onClick={live.screenSharing ? live.stopScreenShare : live.startScreenShare}
            />
          )}
          {live.status === "active" && (
            <CameraShareButton
              sharing={live.cameraSharing}
              onClick={live.cameraSharing ? live.stopCameraShare : live.startCameraShare}
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
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-faint transition-all duration-fast hover:bg-surface-3 hover:text-ink-muted active:scale-95 disabled:opacity-50 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ImagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Imagen</span>
          </button>
        </div>
        <div className="flex items-end gap-1 rounded-[24px] bg-surface-3 py-2 pr-2 pl-2">
          <VoiceButton status={voice.status} onClick={voice.status === "recording" ? voice.stop : voice.start} />
          <input
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-base text-ink outline-none placeholder:text-ink-faint"
            placeholder="Escribile a KAN…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isSending}
          />
          <button
            type="submit"
            aria-label="Enviar mensaje"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-transform duration-fast hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            disabled={isSending || !input.trim()}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
      </Wrapper>
    </>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex items-center gap-1.5 self-start rounded-full bg-surface-3 px-3 py-1 text-xs text-ink-faint">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
        message.role === "user"
          ? "bg-gradient-accent glow-accent-sm self-end text-white"
          : "glass self-start border border-line/60 text-ink"
      }`}
    >
      {message.toolCall && (
        <div className="mb-1 flex items-center gap-1 text-xs opacity-70">
          <Wrench className="h-3 w-3" aria-hidden="true" /> {translateToolCall(message.toolCall.name)}
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
