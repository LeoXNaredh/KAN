"use client";

import { useCallback, useEffect, useRef } from "react";

// Markdown que Gemini suele meter en las respuestas (negrita, listas,
// encabezados, código, links) — sin esto, tanto el TTS de red como
// SpeechSynthesis leen los símbolos literales ("asterisco asterisco...") en
// vez del texto.
const MARKDOWN_PATTERNS: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ""],
  [/`([^`]+)`/g, "$1"],
  [/!\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  [/^#{1,6}\s+/gm, ""],
  [/(\*\*|__)(.*?)\1/g, "$2"],
  [/(\*|_)(.*?)\1/g, "$2"],
  [/^\s*[-*+]\s+/gm, ""],
  [/^\s*\d+\.\s+/gm, ""],
  [/^>\s?/gm, ""],
  [/\|/g, " "],
  [/-{3,}/g, ""],
  [/\s+/g, " "],
];

function stripMarkdownForSpeech(text: string): string {
  return MARKDOWN_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text).trim();
}

function pickSpanishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const spanish = voices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
  if (spanish.length === 0) return undefined;
  // Cuando el navegador expone voces "mejoradas" (ej. las Natural de Edge/Windows,
  // u Online de Chrome), suenan bastante más fluidas que la voz por defecto del sistema.
  const enhanced = spanish.find((voice) => /natural|neural|enhanced|premium|online/i.test(voice.name));
  return enhanced ?? spanish.find((voice) => voice.lang.toLowerCase() === "es-es") ?? spanish[0];
}

/**
 * TTS (ADR-034, docs/00): intenta primero OpenAI vía /api/voice/synthesize
 * (voz real, no robótica) y cae en silencio a la SpeechSynthesis nativa del
 * navegador si esa llamada falla por cualquier motivo (sin OPENAI_API_KEY
 * configurada, red caída, error del proveedor) — mismo espíritu de
 * degradación consciente que ya regía cuando esto era 100% nativo (ADR-014):
 * el chat nunca se rompe por un problema de voz.
 */
export function useSpeechSynthesis() {
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    function loadVoices() {
      voicesRef.current = window.speechSynthesis.getVoices();
    }

    loadVoices();
    // En Chrome/Edge la lista de voces se carga async — vacía en la primera llamada.
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const speakNative = useCallback((clean: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "es-ES";
    utterance.rate = 0.97;
    utterance.pitch = 1;

    const voice = pickSpanishVoice(voicesRef.current);
    if (voice) utterance.voice = voice;

    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    (text: string) => {
      const clean = stripMarkdownForSpeech(text);
      if (!clean) return;

      // Corta cualquier reproducción en curso (red o nativa) antes de
      // empezar la nueva — mismo criterio que el cancel() de antes.
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      audioRef.current?.pause();

      void (async () => {
        try {
          const response = await fetch("/api/voice/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean }),
          });
          if (!response.ok) throw new Error(`TTS de red respondió ${response.status}`);

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.addEventListener("ended", () => URL.revokeObjectURL(url));
          audio.addEventListener("error", () => URL.revokeObjectURL(url));
          await audio.play();
        } catch {
          // Sin ruido en consola a propósito (ADR-014/ADR-034): la falla del
          // proveedor de red no es un error del usuario, es esperable
          // (falta config, rate limit, red) — el fallback nativo la absorbe.
          speakNative(clean);
        }
      })();
    },
    [speakNative],
  );

  return { speak };
}
