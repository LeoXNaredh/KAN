import { randomUUID } from "node:crypto";
import { requiresConfirmation, type ActionSeverity } from "@kan/plugin-contract";
import type { PendingConfirmation } from "../domain/entities/PendingConfirmation";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "./EdgeAgentBus";

export type PermissionDecision =
  | { outcome: "approved" }
  | { outcome: "pending"; confirmation: PendingConfirmation };

/**
 * Aplica ADR-004 (docs/00): `read-only`/`reversible` se aprueban directo;
 * `irreversible-material`/`safety-critical` quedan pendientes hasta
 * confirmación explícita del usuario. Esta es la única puerta por la que
 * pasa cualquier invocación de capability (ver CapabilityRegistry).
 */
export class PermissionManager {
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
  ) {}

  evaluate(deviceId: string, capabilityName: string, severity: ActionSeverity, input: unknown): PermissionDecision {
    if (!requiresConfirmation(severity)) {
      return { outcome: "approved" };
    }

    const confirmation: PendingConfirmation = {
      id: randomUUID(),
      deviceId,
      capabilityName,
      input,
      severity,
      requestedAt: new Date().toISOString(),
    };
    this.pending.set(confirmation.id, confirmation);
    this.logger.warn(`Confirmación requerida: ${capabilityName} en ${deviceId} (${severity})`);
    this.bus.emit("permission.pending", { confirmation });
    return { outcome: "pending", confirmation };
  }

  resolve(confirmationId: string, approved: boolean): PendingConfirmation | undefined {
    const confirmation = this.pending.get(confirmationId);
    if (!confirmation) return undefined;
    this.pending.delete(confirmationId);
    this.bus.emit("permission.resolved", { confirmationId, approved });
    return confirmation;
  }

  listPending(): PendingConfirmation[] {
    return Array.from(this.pending.values());
  }
}
