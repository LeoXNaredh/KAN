import type { ActionSeverity, ConfirmationResolvedMessage } from "@kan/plugin-contract";
import type { ConnectionManagerPort } from "../domain/ports/ConnectionManagerPort";
import type { AgentRegistry } from "./AgentRegistry";

// Mismo orden que TASK_TIMEOUT_MS de TaskOrchestrator — esto solo cubre
// Gateway -> Edge Agent -> ack, NO la espera humana de hasta 10 minutos
// (PermissionManager, del lado del Edge Agent): esa espera ocurre
// enteramente del lado del cliente, antes de siquiera llamar a resolve().
const RESOLVE_TIMEOUT_MS = 40_000;

export interface PendingConfirmationDetails {
  deviceId: string;
  capabilityName: string;
  input: unknown;
  severity: ActionSeverity;
}

export type ResolveConfirmationResult = { success: boolean; data?: unknown; error?: string };

interface PendingResolve {
  resolve: (result: ResolveConfirmationResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Hermano de `TaskOrchestrator` pero para el sub-protocolo de resolver una
 * confirmación pendiente (ADR-059). Un `confirmationId` ya no tiene un
 * `taskId` vivo asociado del lado del Gateway — `TaskOrchestrator` ya
 * resolvió/olvidó esa tarea en cuanto llegó "pending_confirmation" (decisión
 * de seguridad ya documentada: no espera más). Por eso hace falta su propio
 * mapeo `confirmationId -> Edge Agent` + su propia promesa pendiente.
 */
export class ConfirmationOrchestrator {
  private readonly records = new Map<string, { edgeAgentId: string } & PendingConfirmationDetails>();
  private readonly pending = new Map<string, PendingResolve>();

  constructor(
    private readonly connectionManager: ConnectionManagerPort,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  /**
   * Llamado por `OrchestratorToolExecutor` justo cuando un tool call queda
   * `pending_confirmation` — en ese momento ya tiene toda esta info a mano
   * (la misma `GlobalCapability` que resolvió para el chequeo de ownership),
   * así que queda registrada sin un segundo viaje de ida y vuelta.
   */
  record(confirmationId: string, edgeAgentId: string, details: PendingConfirmationDetails): void {
    this.records.set(confirmationId, { edgeAgentId, ...details });
  }

  /**
   * Bandeja de confirmaciones pendientes (requisito: verlas/aprobarlas fuera
   * del chat que las disparó — ej. una secuencia de una alerta, sin
   * conversación activa) — mismo criterio de filtro por owner que
   * `GlobalCapabilityRegistry.list()`/`AgentRegistry.list()`: sin
   * `requestingUserId`, no filtra; con él, solo las de Edge Agents propios o
   * sin vincular. Nunca incluye `edgeAgentId` en la salida — es un detalle
   * interno, no algo que la UI necesite mostrar.
   */
  list(requestingUserId?: string): Array<PendingConfirmationDetails & { confirmationId: string }> {
    const entries = Array.from(this.records.entries());
    const visible =
      requestingUserId === undefined
        ? entries
        : entries.filter(([, record]) => this.agentRegistry.hasAccess(record.edgeAgentId, requestingUserId));
    return visible.map(([confirmationId, { edgeAgentId: _edgeAgentId, ...details }]) => ({ confirmationId, ...details }));
  }

  /**
   * `requestingUserId`: si el Edge Agent dueño de esta confirmación ya está
   * vinculado a otro usuario, se rechaza acá — sin esto, cualquiera con el
   * `confirmationId` (visible en el evento `pending_confirmation`) podría
   * aprobar/rechazar la acción de otro usuario. Mismo criterio que
   * `Gateway.executeTool()`.
   */
  async resolve(confirmationId: string, approved: boolean, requestingUserId?: string): Promise<ResolveConfirmationResult | undefined> {
    const record = this.records.get(confirmationId);
    // undefined: nunca existió, ya se resolvió, o el Gateway se reinició y
    // perdió el mapeo — limitación aceptada explícitamente (mismo criterio
    // que TaskOrchestrator ya documenta para sus propias tasks en vuelo).
    if (!record) return undefined;

    if (!this.agentRegistry.hasAccess(record.edgeAgentId, requestingUserId)) {
      return { success: false, error: "No autorizado: esta confirmación pertenece a otro usuario." };
    }

    const sent = this.connectionManager.send(record.edgeAgentId, {
      type: "agent_confirmation.resolve",
      confirmationId,
      approved,
    });
    if (!sent) {
      return { success: false, error: "El Edge Agent ya no está conectado" };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(confirmationId);
        resolve({ success: false, error: "Timeout esperando la confirmación del Edge Agent" });
      }, RESOLVE_TIMEOUT_MS);
      this.pending.set(confirmationId, { resolve, timer });
    });
  }

  handleResolved(message: ConfirmationResolvedMessage): void {
    this.records.delete(message.confirmationId);
    const pending = this.pending.get(message.confirmationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.confirmationId);
    pending.resolve({ success: message.success, data: message.data, error: message.error });
  }
}
