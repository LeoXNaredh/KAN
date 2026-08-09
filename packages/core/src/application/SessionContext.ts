import type { SessionContextPort } from "../domain/ports/SessionContextPort";

interface SessionState {
  activeDeviceId?: string;
  activeProjectId?: string;
  currentTask?: string;
}

// Módulo-nivel, compartido entre requests que caigan en el mismo proceso —
// mismo criterio ya aceptado que `fallbackConversationRepository` en
// apps/web/lib/chat/composition.ts: no sobrevive un restart ni un container
// serverless distinto, pero alcanza para "recordarlo durante la sesión" sin
// necesitar una tabla nueva en Supabase todavía (ver ADR-055 sobre por qué
// no se persiste de entrada).
const sessions = new Map<string, SessionState>();

/**
 * SessionContextPort en memoria, por usuario (ADR-055) — el Core
 * "gestiona contexto" que nombra el prompt maestro: qué dispositivo,
 * proyecto o tarea está activo ahora mismo. Escopeado por `userId`, no por
 * `conversationId`, a propósito: el `conversationId` de una conversación
 * nueva recién existe DESPUÉS de que `SendMessageUseCase.execute()` arranca
 * (ver `createConversation()` ahí), demasiado tarde para construir este
 * objeto en el composition root — mismo momento del ciclo de vida que
 * `UserScopedMemoryContext`, que ya resuelve esto escopeando por usuario.
 */
export class SessionContext implements SessionContextPort {
  constructor(private readonly userId: string) {}

  private read(): SessionState {
    return sessions.get(this.userId) ?? {};
  }

  private write(patch: Partial<SessionState>): void {
    sessions.set(this.userId, { ...this.read(), ...patch });
  }

  async getActiveDevice(): Promise<string | undefined> {
    return this.read().activeDeviceId;
  }

  async setActiveDevice(deviceId: string): Promise<void> {
    this.write({ activeDeviceId: deviceId });
  }

  async getActiveProject(): Promise<string | undefined> {
    return this.read().activeProjectId;
  }

  async setActiveProject(projectId: string): Promise<void> {
    this.write({ activeProjectId: projectId });
  }

  async getCurrentTask(): Promise<string | undefined> {
    return this.read().currentTask;
  }

  async setCurrentTask(task: string): Promise<void> {
    this.write({ currentTask: task });
  }

  async clear(): Promise<void> {
    sessions.delete(this.userId);
  }
}
