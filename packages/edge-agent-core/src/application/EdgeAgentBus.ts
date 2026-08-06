import { EventEmitter } from "node:events";
import type { ActionSeverity, CapabilityResult } from "@kan/plugin-contract";
import type { Device } from "../domain/entities/Device";
import type { PendingConfirmation } from "../domain/entities/PendingConfirmation";
import type { LogLevel } from "../domain/ports/LoggerPort";
import type { CoreConnectionStatus } from "../domain/ports/CoreConnectionPort";

export interface EdgeAgentEvents {
  "plugin.loaded": { pluginId: string };
  "plugin.error": { pluginId: string; error: string };
  "device.connected": { device: Device };
  "device.disconnected": { deviceId: string };
  "capability.invoked": { deviceId: string; capability: string; severity: ActionSeverity };
  "capability.completed": { deviceId: string; capability: string; result: CapabilityResult };
  "capability.failed": { deviceId: string; capability: string; error: string };
  "permission.pending": { confirmation: PendingConfirmation };
  "permission.resolved": { confirmationId: string; approved: boolean };
  "core.status": { status: CoreConnectionStatus };
  log: { level: LogLevel; message: string; meta?: Record<string, unknown>; at: string };
}

/**
 * Bus interno tipado (requisito 7, "Communication Layer"): los módulos del
 * Edge Agent se comunican emitiendo/escuchando eventos aquí en vez de
 * llamarse entre sí directamente. Esto es lo que permite que, por ejemplo,
 * el Device Manager funcione sin que exista todavía una conexión al Core
 * (Modo Offline, requisito 14).
 */
export class EdgeAgentBus {
  private readonly emitter = new EventEmitter();

  emit<K extends keyof EdgeAgentEvents>(event: K, payload: EdgeAgentEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof EdgeAgentEvents>(event: K, handler: (payload: EdgeAgentEvents[K]) => void): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof EdgeAgentEvents>(event: K, handler: (payload: EdgeAgentEvents[K]) => void): void {
    this.emitter.off(event, handler);
  }
}
