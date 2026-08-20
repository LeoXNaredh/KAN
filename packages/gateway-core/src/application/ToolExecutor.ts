import type { ToolExecutionResult } from "@kan/plugin-contract";
import type { ResolvedToolCall } from "./ToolResolver";
import type { TaskOrchestrator } from "./TaskOrchestrator";
import type { ConfirmationOrchestrator } from "./ConfirmationOrchestrator";
import type { AuditService } from "./AuditService";
import type { GatewayBus } from "./GatewayBus";
import type { GlobalCapability } from "../domain/entities/GlobalCapability";

/**
 * El único lugar que decide CÓMO ejecutar una tool — KAN, no el LLM
 * (docs/12 §5). Ningún proveedor de IA tiene una línea de código que
 * toque TaskOrchestrator; solo esto lo hace.
 *
 * `capability` (ADR-059): la `GlobalCapability` ya resuelta por quien llama
 * (`Gateway.executeTool()` ya la resuelve para el chequeo de ownership) —
 * se reusa acá en vez de resolverla una segunda vez, y es lo que permite
 * registrar `deviceId`/`capabilityName`/`severity` en `ConfirmationOrchestrator`
 * cuando el resultado queda `pending_confirmation`.
 */
export interface ToolExecutorPort {
  execute(call: ResolvedToolCall, capability: GlobalCapability, requestingUserId?: string): Promise<ToolExecutionResult>;
}

export class OrchestratorToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly orchestrator: TaskOrchestrator,
    private readonly confirmationOrchestrator: ConfirmationOrchestrator,
    private readonly audit: AuditService,
    private readonly bus: GatewayBus,
  ) {}

  async execute(call: ResolvedToolCall, capability: GlobalCapability, requestingUserId?: string): Promise<ToolExecutionResult> {
    this.bus.emit("tool.proposed", { name: call.ref, args: call.args });
    this.audit.record({
      actor: "llm",
      action: "tool.execute",
      subject: call.ref,
      userId: requestingUserId,
      metadata: { args: call.args },
    });

    const result = await this.orchestrator.submit({ capabilityRef: call.ref, input: call.args });

    const execResult: ToolExecutionResult =
      result.status === "pending_confirmation"
        ? this.buildPendingConfirmationResult(result.confirmationId!, call, capability)
        : { success: result.status === "done", data: result.data, error: result.error };

    // Segunda entrada aditiva (DailyReportService, reporte diario por
    // email): "tool.execute" arriba se audita ANTES de ejecutar (es la
    // propuesta, no el resultado) — sin esto no hay forma de saber
    // exitosas/fallidas después. `pending_confirmation` no genera esta
    // entrada: su resultado final (si se aprueba) no se audita hoy tampoco
    // (límite preexistente de ConfirmationOrchestrator, fuera de alcance acá).
    if (result.status !== "pending_confirmation") {
      this.audit.record({
        actor: "system",
        action: "tool.execute.result",
        subject: call.ref,
        userId: requestingUserId,
        metadata: { success: execResult.success, error: execResult.error },
      });
    }

    this.bus.emit("tool.executed", { name: call.ref, result: execResult });
    return execResult;
  }

  private buildPendingConfirmationResult(
    confirmationId: string,
    call: ResolvedToolCall,
    capability: GlobalCapability,
  ): ToolExecutionResult {
    this.confirmationOrchestrator.record(confirmationId, capability.edgeAgentId, {
      deviceId: capability.deviceId,
      capabilityName: capability.capability.name,
      input: call.args,
      severity: capability.capability.severity,
    });
    return {
      success: false,
      requiresConfirmation: true,
      data: {
        confirmationId,
        deviceId: capability.deviceId,
        capabilityName: capability.capability.name,
        input: call.args,
        severity: capability.capability.severity,
      },
      error: "Esta acción requiere confirmación explícita antes de ejecutarse.",
    };
  }
}
