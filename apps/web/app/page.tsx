"use client";

import { useState, type FormEvent } from "react";

type ChatRole = "user" | "assistant" | "tool";

interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCall?: { name: string; args: unknown };
}

export default function Home() {
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
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">KAN</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Chat conectado a Gemini a través del Core, con function-calling contra el Gateway y
            los dispositivos del Edge Agent.
          </p>
        </header>

        <div className="flex min-h-[24rem] flex-1 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {messages.length === 0 && (
            <p className="text-sm text-zinc-500">Escribe un mensaje para empezar la conversación.</p>
          )}
          {messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}
          {isSending && <p className="text-sm text-zinc-500">KAN está pensando…</p>}
        </div>

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            placeholder="Escribe un mensaje..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isSending}
          />
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
            disabled={isSending || !input.trim()}
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="self-start rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
        message.role === "user"
          ? "self-end bg-black text-white dark:bg-zinc-50 dark:text-black"
          : "self-start bg-zinc-100 text-black dark:bg-zinc-800 dark:text-zinc-50"
      }`}
    >
      {message.toolCall && (
        <div className="mb-1 text-xs opacity-60">🔧 llamando a {message.toolCall.name}</div>
      )}
      {message.content}
    </div>
  );
}
