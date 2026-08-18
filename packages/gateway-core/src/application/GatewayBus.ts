import { EventEmitter } from "node:events";
import type { AuditEntry } from "../domain/entities/AuditEntry";
import type { TaskResult } from "../domain/entities/GatewayTask";
import type { ToolExecutionResult } from "@kan/plugin-contract";

export interface GatewayEvents {
  "agent.connected": { edgeAgentId: string };
  "agent.disconnected": { edgeAgentId: string };
  "capability.synced": { edgeAgentId: string; count: number };
  "task.dispatched": { taskId: string; capabilityRef: string };
  "task.completed": { taskId: string; result: TaskResult };
  "task.failed": { taskId: string; error: string };
  "tool.proposed": { name: string; args: unknown };
  "tool.executed": { name: string; result: ToolExecutionResult };
  "audit.recorded": { entry: AuditEntry };
  "job.fired": { jobId: string; capabilityRef: string };
  "job.step_failed": { jobId: string; capabilityRef: string; error: string };
  "job.notification": { jobId: string; title: string };
  /** Investigación automática de un tipo de dispositivo nuevo (ADR-053). */
  "device.enriched": { ownerId: string; deviceKind: string; summary: string; deviceNames: string[]; sources?: string[] };
  /** Sistema básico de alertas — disparado solo en la transición "normal" -> "cruzada" de una AlertRule (ver AlertMonitor). */
  "alert.triggered": { alertId: string; capabilityRef: string; value: number; message: string };
}

/** Mismo patrón que EdgeAgentBus (packages/edge-agent-core) — docs/12 §7. */
export class GatewayBus {
  private readonly emitter = new EventEmitter();

  emit<K extends keyof GatewayEvents>(event: K, payload: GatewayEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof GatewayEvents>(event: K, handler: (payload: GatewayEvents[K]) => void): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof GatewayEvents>(event: K, handler: (payload: GatewayEvents[K]) => void): void {
    this.emitter.off(event, handler);
  }
}
