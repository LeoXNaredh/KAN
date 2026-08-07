"use client";

import { useCallback, useEffect, useRef } from "react";

// Markdown que Gemini suele meter en las respuestas (negrita, listas,
// encabezados, código, links) — sin esto, SpeechSynthesis lee los símbolos
// literales ("asterisco asterisco...") en vez del texto.
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
 * TTS de Fase 1 (ADR-014, docs/00): SpeechSynthesis nativa del navegador,
 * fuera de la capa de puertos — no hay proveedor de red que envolver. Se
 * degrada en silencio si el navegador no la soporta (ej. Firefox Android).
 * Limpia Markdown antes de hablar y prefiere una voz en español "mejorada"
 * si el navegador expone alguna, en vez de la genérica por defecto.
 */
export function useSpeechSynthesis() {
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

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

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const clean = stripMarkdownForSpeech(text);
    if (!clean) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "es-ES";
    utterance.rate = 0.97;
    utterance.pitch = 1;

    const voice = pickSpanishVoice(voicesRef.current);
    if (voice) utterance.voice = voice;

    window.speechSynthesis.speak(utterance);
  }, []);

  return { speak };
}
