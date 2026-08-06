"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * Sin backend todavía (docs/17 §3.4, Voz Fase 1 es un incremento aparte) —
 * existe visualmente para que la identidad del producto empiece a formarse.
 */
export function VoiceButton() {
  const [showComingSoon, setShowComingSoon] = useState(false);

  return (
    <Card padding="lg" className="fade-in flex flex-col items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => setShowComingSoon(true)}
        aria-label="Hablar con KAN"
        className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition-transform duration-fast hover:scale-105 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent active:scale-95"
      >
        <Mic className="h-8 w-8" aria-hidden="true" />
      </button>
      <p className="text-sm font-medium text-ink-muted">Hablar con KAN</p>
      {showComingSoon && <p className="text-xs text-accent">Próximamente</p>}
    </Card>
  );
}
