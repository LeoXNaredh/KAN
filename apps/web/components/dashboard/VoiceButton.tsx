"use client";

import { useState } from "react";

/**
 * Sin backend todavía (docs/17 §3.4, Voz Fase 1 es un incremento aparte) —
 * existe visualmente para que la identidad del producto empiece a formarse.
 */
export function VoiceButton() {
  const [showComingSoon, setShowComingSoon] = useState(false);

  return (
    <div className="fade-in flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
      <button
        type="button"
        onClick={() => setShowComingSoon(true)}
        aria-label="Hablar con KAN"
        className="flex h-20 w-20 items-center justify-center rounded-full bg-sky-600 text-3xl text-white shadow-lg shadow-sky-950/50 transition-transform hover:scale-105 hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 active:scale-95"
      >
        <span aria-hidden="true">🎤</span>
      </button>
      <p className="text-sm font-medium text-zinc-300">Hablar con KAN</p>
      {showComingSoon && <p className="text-xs text-sky-400">Próximamente</p>}
    </div>
  );
}
