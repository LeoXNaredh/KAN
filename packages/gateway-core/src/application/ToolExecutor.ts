import type { ToolExecutionResult } from "@kan/plugin-contract";
import type { ResolvedToolCall } from "./ToolResolver";
import type { TaskOrchestrator } from "./TaskOrchestrator";
import type { AuditService } from "./AuditService";
import type { GatewayBus } from "./GatewayBus";

/**
 * El único lugar que decide CÓMO ejecutar una tool — KAN, no el LLM
 * (docs/12 §5). Ningún proveedor de IA tiene una línea de código que
 * toque TaskOrchestrator; solo esto lo hace.
 */
export interface ToolExecutorPort {
  execute(call: ResolvedToolCall): Promise<ToolExecutionResult>;
}

export class OrchestratorToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly orchestrator: TaskOrchestrator,
    private readonly audit: AuditService,
    private readonly bus: GatewayBus,
  ) {}

  async execute(call: ResolvedToolCall): Promise<ToolExecutionResult> {
    this.bus.emit("tool.proposed", { name: call.ref, args: call.args });
    this.audit.record({ actor: "llm", action: "tool.execute", subject: call.ref, metadata: { args: call.args } });

    const result = await this.orchestrator.submit({ capabilityRef: call.ref, input: call.args });

    const execResult: ToolExecutionResult =
      result.status === "pending_confirmation"
        ? {
            success: false,
            requiresConfirmation: true,
            data: { confirmationId: result.confirmationId },
            error: "Esta acción requiere confirmación explícita en la app de escritorio del Edge Agent.",
          }
        : { success: result.status === "done", data: result.data, error: result.error };

    this.bus.emit("tool.executed", { name: call.ref, result: execResult });
    return execResult;
  }
}
