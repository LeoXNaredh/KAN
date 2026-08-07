import { useRef, useState } from "react";
import { fetch } from "expo/fetch";
import type { ChatStreamEvent, Conversation } from "@kan/core";
import {
  Alert,
  Image,
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
import { useVoiceInput } from "../../lib/voice/useVoiceInput";
import { useSpeechSynthesis } from "../../lib/voice/useSpeechSynthesis";
import { pickFromCamera, pickFromLibrary, type PickedImage } from "../../lib/image/pickImage";
import { VoiceButton } from "../../components/VoiceButton";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

type ChatRole = "user" | "assistant" | "tool";
interface ChatMessage {
  role: ChatRole;
  content: string;
  image?: PickedImage;
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
 * Chat con streaming, voz e imagen (docs/18, incrementos 3-5): mismo
 * `/api/chat` SSE que ya usa apps/web, consumido con `expo/fetch` (ADR-027)
 * y autenticado con `Authorization: Bearer <token>` (ADR-029). Voz vía
 * `/api/voice/transcribe` (mismo contrato que web, subida por
 * `XMLHttpRequest` — ver ADR-032) + síntesis nativa; imagen adjunta con el
 * mismo shape `{ data, mimeType }` que ya acepta el backend (ADR-018).
 */
export default function ChatScreen() {
  const { session, useCases } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { speak } = useSpeechSynthesis();

  async function sendMessage(overrideMessage?: string) {
    const trimmed = (overrideMessage ?? input).trim();
    if (!trimmed || isSending) return;

    const image = pendingImage ?? undefined;
    const preSubmitCount = messages.length;
    setMessages((prev) => [...prev, { role: "user", content: trimmed, image }]);
    setInput("");
    setPendingImage(null);
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
        body: JSON.stringify({ message: trimmed, conversationId, image }),
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

      // Mismo momento que apps/web: una sola vez, sobre el último mensaje
      // assistant, después de que el stream completo terminó.
      const lastAssistantMessage = [...newMessages].reverse().find((m) => m.role === "assistant");
      if (lastAssistantMessage?.content) speak(lastAssistantMessage.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSending(false);
      setStreamingStatus(null);
    }
  }

  const voice = useVoiceInput(sendMessage);

  function handleAttachImage() {
    Alert.alert("Adjuntar imagen", undefined, [
      { text: "Galería", onPress: () => runPicker(pickFromLibrary) },
      { text: "Cámara", onPress: () => runPicker(pickFromCamera) },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function runPicker(picker: () => ReturnType<typeof pickFromLibrary>) {
    const result = await picker();
    if (result.ok) {
      setError(null);
      setPendingImage(result.image);
    } else if (!("canceled" in result)) {
      setError(result.error);
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
          <Text className="text-sm text-ink-faint">Escribí un mensaje, hablá, o adjuntá una imagen para empezar.</Text>
        )}
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
        {isSending && (
          <Text className="text-sm text-ink-faint">{streamingStatus ?? "KAN está pensando…"}</Text>
        )}
        {(error || voice.error) && (
          <Text className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error ?? voice.error}
          </Text>
        )}
      </ScrollView>

      {pendingImage && (
        <View className="mx-4 mb-2 flex-row items-center gap-2 self-start rounded-md border border-line bg-surface-3 px-2 py-1.5">
          <Image
            source={{ uri: `data:${pendingImage.mimeType};base64,${pendingImage.data}` }}
            className="h-10 w-10 rounded"
          />
          <Text className="text-xs text-ink-muted">Imagen lista para enviar</Text>
          <Pressable onPress={() => setPendingImage(null)}>
            <Text className="text-xs text-ink-faint">✕</Text>
          </Pressable>
        </View>
      )}

      <View className="flex-row items-center gap-2 border-t border-line px-4 py-3">
        <Pressable
          className="rounded-lg border border-line px-3 py-2 active:opacity-80 disabled:opacity-50"
          disabled={isSending}
          onPress={handleAttachImage}
        >
          <Text className="text-sm text-ink-muted">📎</Text>
        </Pressable>
        <VoiceButton status={voice.status} onPress={voice.status === "recording" ? voice.stop : voice.start} />
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
          onPress={() => sendMessage()}
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
      {message.image && (
        <Image
          source={{ uri: `data:${message.image.mimeType};base64,${message.image.data}` }}
          className="mb-1.5 h-32 w-full rounded-md"
          resizeMode="cover"
        />
      )}
      <Text className={`text-sm ${message.role === "user" ? "text-white" : "text-ink"}`}>{message.content}</Text>
    </View>
  );
}
