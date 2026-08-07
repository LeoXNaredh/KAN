"use client";

import { useState, useCallback, type FormEvent } from "react";
import { Send, Wrench } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { VoiceButton } from "@/components/dashboard/VoiceButton";
import { useVoiceInput } from "@/lib/voice/useVoiceInput";
import { useSpeechSynthesis } from "@/lib/voice/useSpeechSynthesis";

type ChatRole = "user" | "assistant" | "tool";

interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCall?: { name: string; args: unknown };
}

/**
 * Lógica de chat extraída de la antigua app/page.tsx (misma llamada a
 * /api/chat, mismo estado) — ahora reutilizable: compacta dentro del
 * Dashboard, a tamaño completo en /conversacion. Desde P1, también acepta
 * voz: transcribir (ADR-014) reutiliza este mismo sendMessage() sin
 * cambios, y la respuesta final se lee en voz alta.
 */
export function ConversationPanel({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { speak } = useSpeechSynthesis();

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim() || isSending) return;
      const trimmed = userMessage.trim();
      const preSubmitCount = messages.length;
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setInput("");
      setIsSending(true);
      setError(null);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, conversationId }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "Error desconocido");
        }

        setConversationId(data.conversation.id);

        // El mensaje de usuario ya se mostró de forma optimista; el resto
        // (rondas de herramientas + respuesta final) se añade tal cual llega,
        // así el usuario ve con transparencia qué herramienta se llamó.
        const newMessages: ChatMessage[] = data.conversation.messages
          .slice(preSubmitCount + 1)
          .map((m: { role: ChatRole; content: string; toolCall?: { name: string; args: unknown } }) => ({
            role: m.role,
            content: m.content,
            toolCall: m.toolCall,
          }));
        setMessages((prev) => [...prev, ...newMessages]);

        const lastAssistantMessage = [...newMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistantMessage?.content) speak(lastAssistantMessage.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, isSending, messages.length, speak],
  );

  const voice = useVoiceInput(sendMessage);

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
        {isSending && <p className="text-sm text-ink-faint">KAN está pensando…</p>}
      </div>

      {(error || voice.error) && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error ?? voice.error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <VoiceButton
          status={voice.status}
          onClick={voice.status === "recording" ? voice.stop : voice.start}
        />
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
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:brightness-110 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          disabled={isSending || !input.trim()}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Enviar
        </button>
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
      {message.content}
    </div>
  );
}
