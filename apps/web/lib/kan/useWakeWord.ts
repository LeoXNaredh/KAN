"use client";

import { useEffect, useRef } from "react";

// Variantes fonéticas pedidas — "Kan"/"Can" son sílabas cortas que el
// reconocimiento de voz en español/inglés confunde fácil entre sí; se
// matchea como palabra completa (\b) para no disparar con "cansado",
// "canción", etc.
const WAKE_WORD_PATTERN = /\b(kan|khan|can|cannes|canes)\b/i;

// Minimal: solo lo que este hook usa de la Web Speech API (no está en
// lib.dom.d.ts de TypeScript todavía — Safari/Firefox tampoco la
// implementan, de ahí el chequeo `isSupported` antes de instanciar nada).
interface MinimalSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

type SpeechRecognitionConstructor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isWakeWordSupported(): boolean {
  return getSpeechRecognitionCtor() !== undefined;
}

/**
 * Detección continua de "KAN" en background (Web Speech API, reconocimiento
 * del navegador — no pasa por el Gateway ni por ningún proveedor de KAN,
 * es puramente local al tab). Al detectarla, llama `onWakeWord()` — quien
 * use el hook decide qué hacer (ConversationPanel/KANHome arrancan
 * `useVoiceInput`). No compite con el micrófono real: `enabled` debe
 * apagarse mientras `voice.status !== "idle"` (grabando/transcribiendo),
 * porque el propio audio de KAN respondiendo puede autodispararse si el
 * reconocimiento de wake word sigue escuchando durante la respuesta.
 *
 * Reinicia sola cuando el navegador corta la sesión de reconocimiento
 * (los navegadores la cierran solas después de un rato de silencio) —
 * "continua" en la práctica significa "se reinicia sola", la API no ofrece
 * una sesión verdaderamente infinita.
 */
export function useWakeWord(onWakeWord: () => void, enabled: boolean): void {
  const onWakeWordRef = useRef(onWakeWord);
  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
  }, [onWakeWord]);

  useEffect(() => {
    if (!enabled) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    let stopped = false;
    let recognition: MinimalSpeechRecognition | undefined;

    function start() {
      if (stopped) return;
      recognition = new Ctor!();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "es-ES";
      recognition.onresult = (event) => {
        for (let i = 0; i < event.results.length; i += 1) {
          const transcript = event.results[i][0]?.transcript ?? "";
          if (WAKE_WORD_PATTERN.test(transcript)) {
            onWakeWordRef.current();
            return;
          }
        }
      };
      recognition.onerror = () => {
        // "no-speech"/"aborted" son ruido normal de una sesión continua —
        // onend igual dispara después y reinicia; nada que loguear acá.
      };
      recognition.onend = () => {
        if (!stopped) start();
      };
      recognition.start();
    }

    start();

    return () => {
      stopped = true;
      recognition?.stop();
    };
  }, [enabled]);
}
