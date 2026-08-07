import { Pressable, Text } from "react-native";
import type { VoiceInputStatus } from "../lib/voice/useVoiceInput";

const LABEL: Record<VoiceInputStatus, string> = {
  idle: "🎤",
  recording: "● Grabando",
  transcribing: "Transcribiendo…",
};

/**
 * Mismos 3 estados que apps/web/components/dashboard/VoiceButton.tsx, sin
 * agregar una librería de iconos nueva (docs/18, incremento 4) — texto
 * simple, consistente con el resto de la UI nativa hasta ahora. Tap para
 * empezar, tap para terminar — no push-to-hold, igual que web.
 */
export function VoiceButton({ status, onPress }: { status: VoiceInputStatus; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={status === "transcribing"}
      accessibilityLabel={status === "idle" ? "Hablar con KAN" : LABEL[status]}
      className={`items-center justify-center rounded-lg px-3 py-2 active:opacity-80 disabled:opacity-50 ${
        status === "recording" ? "bg-danger" : "border border-line"
      }`}
    >
      <Text className={`text-sm ${status === "recording" ? "text-white" : "text-ink-muted"}`}>
        {LABEL[status]}
      </Text>
    </Pressable>
  );
}
