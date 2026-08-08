import type { ActionSeverity, CapabilityResult, PluginPermissions } from "@kan/plugin-contract";
import type { Device } from "../domain/entities/Device";
import type { PendingConfirmation } from "../domain/entities/PendingConfirmation";
import type { SafetyPolicyEntry } from "../domain/entities/SafetyPolicyEntry";
import type { LogLevel } from "../domain/ports/LoggerPort";
import type { CoreConnectionStatus } from "../domain/ports/CoreConnectionPort";

export interface EdgeAgentEvents {
  "plugin.loaded": { pluginId: string };
  "plugin.error": { pluginId: string; error: string };
  /** P8 (ADR-041): deny-by-default — el plugin quedó registrado pero no habilitado hasta que se apruebe. */
  "plugin.permission_pending": { pluginId: string; displayName: string; permissions: PluginPermissions };
  "plugin.permission_resolved": { pluginId: string; approved: boolean };
  "device.connected": { device: Device };
  "device.disconnected": { deviceId: string };
  "capability.invoked": { deviceId: string; capability: string; severity: ActionSeverity };
  "capability.completed": { deviceId: string; capability: string; result: CapabilityResult };
  "capability.failed": { deviceId: string; capability: string; error: string };
  "permission.pending": { confirmation: PendingConfirmation };
  "permission.resolved": { confirmationId: string; approved: boolean };
  "safety_policy.changed": { entry: SafetyPolicyEntry; previousSeverity?: ActionSeverity };
  "core.status": { status: CoreConnectionStatus };
  log: { level: LogLevel; message: string; meta?: Record<string, unknown>; at: string };
}

/**
 * Bus interno tipado (requisito 7, "Communication Layer"): los módulos del
 * Edge Agent se comunican emitiendo/escuchando eventos aquí en vez de
 * llamarse entre sí directamente. Esto es lo que permite que, por ejemplo,
 * el Device Manager funcione sin que exista todavía una conexión al Core
 * (Modo Offline, requisito 14).
 *
 * Emisor propio (sin `node:events`) a propósito: este módulo lo importa
 * también `apps/web` para el Edge Agent del Simulador en el navegador
 * (`@kan/edge-agent-core/browser`), donde el módulo `events` de Node no
 * existe.
 */
export class EdgeAgentBus {
  private readonly handlers = new Map<keyof EdgeAgentEvents, Set<(payload: never) => void>>();

  emit<K extends keyof EdgeAgentEvents>(event: K, payload: EdgeAgentEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) (handler as (payload: EdgeAgentEvents[K]) => void)(payload);
  }

  on<K extends keyof EdgeAgentEvents>(event: K, handler: (payload: EdgeAgentEvents[K]) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
  }

  off<K extends keyof EdgeAgentEvents>(event: K, handler: (payload: EdgeAgentEvents[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }
}
