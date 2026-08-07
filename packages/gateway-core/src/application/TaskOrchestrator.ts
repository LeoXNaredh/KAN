import { randomUUID } from "node:crypto";
import type { AgentTaskDispatchMessage, TelemetryMessage } from "@kan/plugin-contract";
import type { GatewayTask, TaskRequest, TaskResult } from "../domain/entities/GatewayTask";
import type { ConnectionManagerPort } from "../domain/ports/ConnectionManagerPort";
import type { AgentRegistry } from "./AgentRegistry";
import type { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";
import type { GatewayBus } from "./GatewayBus";

// 40s (ADR-027, docs/16 P7): cubre la operación más lenta conocida hoy
// (`home_axes` en plugin-gcode, HOME_TIMEOUT_MS=30s) más margen de
// red/dispatch — antes 15s, insuficiente para esa capability.
const TASK_TIMEOUT_MS = 40_000;
/** Cuánto se conserva una tarea resuelta para poder consultarla vía getTask() antes de purgarla (evita crecimiento sin límite — hallazgo A3 de docs/13). */
const TASK_RETENTION_MS = 5 * 60_000;

interface PendingTask {
  resolve: (result: TaskResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Único creador de GatewayTask (docs/12 §4). Cuando el Edge Agent responde
 * "pending_confirmation" (ADR-004), resuelve de inmediato sin esperar más:
 * la confirmación de una acción física peligrosa se queda en el Edge Agent,
 * nunca se delega al canal de chat — decisión de seguridad, no una limitación.
 */
export class TaskOrchestrator {
  private readonly tasks = new Map<string, GatewayTask>();
  private readonly pending = new Map<string, PendingTask>();

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly capabilityRegistry: GlobalCapabilityRegistry,
    private readonly connectionManager: ConnectionManagerPort,
    private readonly bus: GatewayBus,
  ) {}

  async submit(request: TaskRequest): Promise<TaskResult> {
    const capability = this.capabilityRegistry.resolve(request.capabilityRef);
    if (!capability) {
      return { status: "failed", error: `Capability desconocida: ${request.capabilityRef}` };
    }

    const agent = this.agentRegistry.get(capability.edgeAgentId);
    if (!agent || agent.status !== "online") {
      return { status: "failed", error: `El Edge Agent ${capability.edgeAgentId} no está conectado` };
    }

    const taskId = randomUUID();
    const task: GatewayTask = { id: taskId, capabilityRef: request.capabilityRef, status: "dispatched", createdAt: new Date().toISOString() };
    this.tasks.set(taskId, task);

    const message: AgentTaskDispatchMessage = {
      type: "agent_task.dispatch",
      taskId,
      deviceId: capability.deviceId,
      capability: capability.capability.name,
      severity: capability.capability.severity,
      requiresConfirmation: false,
      payload: request.input,
      issuedAt: new Date().toISOString(),
    };

    this.bus.emit("task.dispatched", { taskId, capabilityRef: request.capabilityRef });

    const resultPromise = new Promise<TaskResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        const timeoutResult: TaskResult = { status: "failed", error: "Timeout esperando respuesta del Edge Agent" };
        task.status = "failed";
        this.bus.emit("task.failed", { taskId, error: timeoutResult.error! });
        resolve(timeoutResult);
      }, TASK_TIMEOUT_MS);
      this.pending.set(taskId, { resolve, timer });
    });

    const sent = this.connectionManager.send(capability.edgeAgentId, message);
    if (!sent) {
      this.resolvePending(taskId, { status: "failed", error: "No se pudo enviar el comando al Edge Agent" });
    }

    return resultPromise;
  }

  getTask(taskId: string): GatewayTask | undefined {
    return this.tasks.get(taskId);
  }

  handleTelemetry(message: TelemetryMessage): void {
    if (message.status === "progress") return; // reservado para telemetría incremental futura

    const result: TaskResult = {
      status: message.status,
      data: message.data,
      error: message.error,
      confirmationId: message.confirmationId,
    };
    this.resolvePending(message.taskId, result);
  }

  private resolvePending(taskId: string, result: TaskResult): void {
    const pending = this.pending.get(taskId);
    const task = this.tasks.get(taskId);
    if (task) task.status = result.status;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(taskId);
    if (result.status === "failed") {
      this.bus.emit("task.failed", { taskId, error: result.error ?? "error desconocido" });
    } else {
      this.bus.emit("task.completed", { taskId, result });
    }
    pending.resolve(result);
    setTimeout(() => this.tasks.delete(taskId), TASK_RETENTION_MS);
  }
}
