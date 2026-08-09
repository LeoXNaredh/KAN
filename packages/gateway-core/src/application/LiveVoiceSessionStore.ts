import { randomUUID } from "node:crypto";
import type { ToolDescriptor } from "@kan/plugin-contract";

export interface LiveVoiceSessionConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDescriptor[];
}

// Ventana para que el browser efectivamente conecte tras registrar la
// sesión — no es la duración de la conversación en sí (eso lo maneja Gemini
// del otro lado de GeminiLiveProxy), es solo cuánto puede tardar en llegar
// el upgrade del WebSocket.
const SESSION_TTL_MS = 5 * 60_000;

/**
 * Registro de un solo uso para una sesión de voz en tiempo real (ADR-044,
 * rediseño del proxy vía Gateway): `apps/web` registra acá la config ya
 * resuelta (system prompt + tools) vía `POST /v1/live-sessions`, y el
 * browser recibe solo un `sessionId` opaco para conectar el WebSocket
 * `/live-voice` — nunca ve el system prompt armado ni la key real de
 * Gemini. `claim()` borra la entrada al leerla (un solo uso, mismo criterio
 * que un código de un solo uso), y una sesión vencida sin reclamar
 * simplemente queda inservible hasta que el reaper (o el próximo intento
 * de claim) la descarta — no hay nada sensible que limpiar activamente.
 */
export interface LiveVoiceSessionRegistration {
  sessionId: string;
  expiresAt: string;
}

export class LiveVoiceSessionStore {
  private readonly sessions = new Map<string, { config: LiveVoiceSessionConfig; expiresAt: number }>();

  constructor(private readonly ttlMs: number = SESSION_TTL_MS) {}

  register(config: LiveVoiceSessionConfig): LiveVoiceSessionRegistration {
    const sessionId = randomUUID();
    const expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(sessionId, { config, expiresAt });
    return { sessionId, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Un solo uso: la entrada se borra tanto si es válida como si ya venció. */
  claim(sessionId: string): LiveVoiceSessionConfig | undefined {
    const entry = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry.config;
  }
}
