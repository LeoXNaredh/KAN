export type KANPhase = "home" | "working";
export type KANActivity = "idle" | "listening" | "thinking" | "speaking";

/**
 * Deriva la fase/actividad visual de KAN (rediseño de identidad, 3 estados)
 * directo del estado real de la conversación (`useConversation`) — nunca un
 * estado paralelo que pueda desincronizarse. "home" (KAN centrado) hasta el
 * primer mensaje; desde ahí queda en "working" (esquina + panel) para el
 * resto de la sesión, aunque el usuario borre el historial visualmente —
 * volver a "home" sin recargar no tiene una señal de producto clara
 * todavía (mismo criterio que el `clear()` sin llamar de ADR-045).
 */
export function useKANState(input: {
  hasMessages: boolean;
  isSending: boolean;
  isSpeaking: boolean;
  isListening: boolean;
}): { phase: KANPhase; activity: KANActivity } {
  const phase: KANPhase = input.hasMessages ? "working" : "home";

  const activity: KANActivity = input.isListening
    ? "listening"
    : input.isSending
      ? "thinking"
      : input.isSpeaking
        ? "speaking"
        : "idle";

  return { phase, activity };
}
