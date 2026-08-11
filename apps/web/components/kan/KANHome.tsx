"use client";

import { useRef, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Cpu, FolderKanban, Home as HomeIcon, ImagePlus, Send, Volume2, Workflow, X } from "lucide-react";
import { KANLayout } from "@/components/kan/KANLayout";
import { MessageBubble } from "@/components/dashboard/ConversationPanel";
import { VoiceButton } from "@/components/dashboard/VoiceButton";
import { LiveVoiceButton } from "@/components/dashboard/LiveVoiceButton";
import { ScreenShareButton } from "@/components/dashboard/ScreenShareButton";
import { useConversation } from "@/lib/chat/useConversation";
import { useKANState } from "@/lib/kan/useKANState";
import { useWakeWord } from "@/lib/kan/useWakeWord";

const SIDE_NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: HomeIcon },
  { href: "/dispositivos", label: "Dispositivos", icon: Cpu },
  { href: "/automatizaciones", label: "Recordatorios", icon: Workflow },
  { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
];

/**
 * Pantalla principal del rediseño de identidad KAN (Kukulkán) — compone
 * `useConversation` (misma lógica que `ConversationPanel`) + `useKANState`
 * (deriva la fase/actividad visual) + `useWakeWord` (activa el micrófono
 * al decir "KAN") + `KANLayout` (los 3 estados). `panelExtras` recibe los
 * widgets ya existentes del Dashboard (dispositivos, plugins, actividad) —
 * `KANHome` no vuelve a pedir esos datos, los recibe ya resueltos, para no
 * duplicar el fetch/estado que `DashboardClient` ya tiene.
 */
export function KANHome({
  panelExtras,
  greeting,
  homeContent,
}: {
  panelExtras?: ReactNode;
  greeting?: string;
  /** Contenido extra de "home" (sin mensajes todavía), debajo del avatar/hint — ej. `OnboardingWelcome`. */
  homeContent?: ReactNode;
}) {
  const conv = useConversation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasMessages = conv.messages.length > 0;

  const { phase, activity } = useKANState({
    hasMessages,
    isSending: conv.isSending,
    isSpeaking: conv.isSpeaking,
    isListening: conv.voice.status === "recording",
  });

  // Wake word solo activo cuando no hay nada más escuchando/hablando ya
  // (evita que KAN se autodispare con su propia voz de TTS, y evita pisar
  // una grabación push-to-talk ya en curso).
  const wakeWordEnabled = conv.voice.status === "idle" && conv.live.status !== "active" && !conv.isSpeaking;
  useWakeWord(() => {
    if (conv.voice.status === "idle") conv.voice.start();
  }, wakeWordEnabled);

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await conv.selectImage(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await conv.sendMessage(conv.input);
  }

  return (
    <KANLayout
      phase={phase}
      activity={activity}
      homeContent={homeContent}
      hint={
        <div className="fade-in flex flex-col items-center gap-1.5">
          {greeting && <p className="text-2xl font-semibold tracking-tight text-ink">{greeting}</p>}
          <p className="text-sm font-medium tracking-wide text-accent uppercase">
            {activity === "listening" ? "Escuchando…" : "Decí “KAN” o escribí abajo"}
          </p>
        </div>
      }
      sideNav={
        <nav aria-label="Accesos rápidos" className="flex flex-col items-center gap-2">
          {SIDE_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint transition-colors duration-fast hover:bg-surface-3 hover:text-accent"
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      }
      panel={
        <div className="flex h-full flex-col gap-4">
          <div className="glass fade-in flex min-h-[20rem] flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-line/80 p-4">
            {conv.messages.map((message, index) => (
              <MessageBubble key={index} message={message} />
            ))}
            {conv.isSending && (
              <p className="flex items-center gap-1.5 text-sm text-ink-faint">
                <span className="flex gap-0.5" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                </span>
                {conv.streamingStatus ?? "KAN está pensando"}
              </p>
            )}
            {!conv.isSending && conv.isSpeaking && (
              <p className="flex items-center gap-1.5 text-sm text-accent">
                <Volume2 className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                KAN está hablando
              </p>
            )}
          </div>

          {(conv.error || conv.voice.error || conv.live.error) && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {conv.error ?? conv.voice.error ?? conv.live.error}
            </p>
          )}

          {panelExtras}
        </div>
      }
      bar={
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <LiveVoiceButton
              status={conv.live.status}
              onClick={conv.live.status === "active" ? conv.live.stop : conv.live.start}
            />
            {conv.live.status === "active" && (
              <ScreenShareButton
                sharing={conv.live.screenSharing}
                onClick={conv.live.screenSharing ? conv.live.stopScreenShare : conv.live.startScreenShare}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleImageSelect}
            />
            <button
              type="button"
              aria-label="Adjuntar imagen"
              title="Adjuntar imagen"
              onClick={() => fileInputRef.current?.click()}
              disabled={conv.isSending}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-faint transition-colors duration-fast hover:bg-surface-3 hover:text-ink-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ImagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Imagen</span>
            </button>
            {conv.pendingImage && (
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface-3 px-2 py-1">
                <img
                  src={`data:${conv.pendingImage.mimeType};base64,${conv.pendingImage.data}`}
                  alt="Imagen a adjuntar"
                  className="h-6 w-6 rounded object-cover"
                />
                <button
                  type="button"
                  aria-label="Quitar imagen"
                  onClick={() => conv.setPendingImage(null)}
                  className="rounded p-0.5 text-ink-faint hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <VoiceButton
              status={conv.voice.status}
              onClick={conv.voice.status === "recording" ? conv.voice.stop : conv.voice.start}
            />
            <input
              className="glass h-14 flex-1 rounded-full border border-line/80 px-5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              placeholder="Habla o escribe con KAN…"
              value={conv.input}
              onChange={(event) => conv.setInput(event.target.value)}
              disabled={conv.isSending}
            />
            <button
              type="submit"
              aria-label="Enviar mensaje"
              className="bg-gradient-accent glow-accent-sm flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white transition-all duration-fast hover:scale-105 hover:brightness-110 disabled:opacity-50 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              disabled={conv.isSending || !conv.input.trim()}
            >
              <Send className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </form>
      }
    />
  );
}
