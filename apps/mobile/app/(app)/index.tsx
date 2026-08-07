import { useRef, useState } from "react";
import { fetch } from "expo/fetch";
import type { ChatStreamEvent, Conversation } from "@kan/core";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "../../lib/auth/SessionProvider";
import { getAccessToken } from "../../lib/supabase/getAccessToken";
import { readSseStream, type ExpoFetchResponse } from "../../lib/chat/parseSseStream";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

type ChatRole = "user" | "assistant" | "tool";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

// Mismo shape que ChatSseEvent en apps/web/app/api/chat/route.ts (ADR-027,
// docs/18 incremento 3) — no se comparte el tipo porque route.ts no es un
// módulo importable fuera de apps/web.
type ChatSseEvent = ChatStreamEvent | { type: "done"; conversation: Conversation } | { type: "done"; error: string };

function summarizeToolResultForDisplay(event: Extract<ChatStreamEvent, { type: "tool_result" }>): string {
  if (!event.success) return `Error ejecutando ${event.name}: ${event.error ?? "desconocido"}`;
  return `Resultado de ${event.name}: ${JSON.stringify(event.data)}`;
}

/**
 * Chat de solo texto con streaming (docs/18, incremento 3): mismo `/api/chat`
 * SSE que ya usa apps/web, consumido con `expo/fetch` (el fetch nativo de RN
 * sobre Hermes no soporta `ReadableStream` — ver ADR-027/docs/18 §3) y
 * autenticado con `Authorization: Bearer <token>` (ADR-029) en vez de
 * cookies. Todavía sin voz ni imagen (docs/18 §5, incrementos aparte).
 */
export default function ChatScreen() {
  const { session, useCases } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const preSubmitCount = messages.length;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setIsSending(true);
    setStreamingStatus(null);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      const response: ExpoFetchResponse = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ message: trimmed, conversationId }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Error desconocido");
      }

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
        .map((m) => ({ role: m.role as ChatRole, content: m.content }));
      setMessages((prev) => [...prev.slice(0, preSubmitCount + 1), ...newMessages]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSending(false);
      setStreamingStatus(null);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-row items-center justify-between border-b border-line px-4 py-3">
        <Text className="text-sm font-semibold text-ink">KAN</Text>
        <Pressable onPress={() => useCases.signOut.execute()}>
          <Text className="text-sm text-ink-faint">Salir ({session?.email})</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4"
        contentContainerClassName="gap-2 py-3"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <Text className="text-sm text-ink-faint">Escribí un mensaje para empezar.</Text>
        )}
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
        {isSending && (
          <Text className="text-sm text-ink-faint">{streamingStatus ?? "KAN está pensando…"}</Text>
        )}
        {error && (
          <Text className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </Text>
        )}
      </ScrollView>

      <View className="flex-row items-center gap-2 border-t border-line px-4 py-3">
        <TextInput
          className="flex-1 rounded-lg border border-line bg-surface-3 px-3 py-2 text-ink"
          placeholder="Escribí un mensaje..."
          placeholderTextColor="#5b6472"
          value={input}
          onChangeText={setInput}
          editable={!isSending}
        />
        <Pressable
          className="rounded-lg bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
          disabled={isSending || !input.trim()}
          onPress={sendMessage}
        >
          <Text className="text-sm font-medium text-white">Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <View className="self-start rounded-md border border-dashed border-line-strong bg-surface-3 px-3 py-1.5">
        <Text className="font-mono text-xs text-ink-muted">{message.content}</Text>
      </View>
    );
  }

  return (
    <View
      className={`max-w-[85%] rounded-lg px-3 py-2 ${
        message.role === "user" ? "self-end bg-accent" : "self-start bg-surface-3"
      }`}
    >
      <Text className={`text-sm ${message.role === "user" ? "text-white" : "text-ink"}`}>{message.content}</Text>
    </View>
  );
}
