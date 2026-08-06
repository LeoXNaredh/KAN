"use client";

import { useState, type FormEvent } from "react";

type ChatRole = "user" | "assistant" | "tool";

interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCall?: { name: string; args: unknown };
}

/**
 * Lógica de chat extraída de la antigua app/page.tsx (misma llamada a
 * /api/chat, mismo estado) — ahora reutilizable: compacta dentro del
 * Dashboard, a tamaño completo en /conversacion.
 */
export function ConversationPanel({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || isSending) return;

    const preSubmitCount = messages.length;
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, conversationId }),
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="fade-in flex h-full flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div
        className={`flex flex-1 flex-col gap-3 overflow-y-auto ${compact ? "min-h-[16rem]" : "min-h-[24rem]"}`}
      >
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">Escribe un mensaje para empezar la conversación.</p>
        )}
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
        {isSending && <p className="text-sm text-zinc-500">KAN está pensando…</p>}
      </div>

      {error && (
        <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          placeholder="Escribe un mensaje..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isSending}
        />
        <button
          type="submit"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
          disabled={isSending || !input.trim()}
        >
          Enviar
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="self-start rounded-md border border-dashed border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-400">
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
        message.role === "user" ? "self-end bg-sky-600 text-white" : "self-start bg-zinc-800 text-zinc-50"
      }`}
    >
      {message.toolCall && <div className="mb-1 text-xs opacity-70">🔧 llamando a {message.toolCall.name}</div>}
      {message.content}
    </div>
  );
}
