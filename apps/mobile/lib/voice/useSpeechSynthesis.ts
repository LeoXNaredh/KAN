import { useCallback } from "react";
import * as Speech from "expo-speech";

// Misma tabla que apps/web/lib/voice/useSpeechSynthesis.ts (duplicada a
// propósito, mismo criterio chico que ADR-031) — Gemini suele devolver
// markdown (negrita, listas, encabezados, código, links) que si no se
// limpia, el motor de síntesis lee los símbolos literales en vez del texto.
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

/**
 * Síntesis de la respuesta (docs/18, incremento 4) — mismo momento que web:
 * se llama una sola vez, sobre el texto final ya completo, nunca de forma
 * incremental durante el streaming. A diferencia de web (que elige una voz
 * en español entre las disponibles del navegador), acá no se fuerza
 * ninguna voz específica — la opción `voice` de `expo-speech` es conocida
 * por no seleccionar de forma confiable la voz pedida (ver ADR-032); se
 * deja que el sistema use su voz por defecto para el idioma indicado,
 * degradación consciente, mismo espíritu que ADR-014.
 */
export function useSpeechSynthesis() {
  const speak = useCallback((text: string) => {
    const clean = stripMarkdownForSpeech(text);
    if (!clean) return;

    Speech.stop();
    Speech.speak(clean, { language: "es-ES", pitch: 1, rate: 0.97 });
  }, []);

  return { speak };
}
